/**
 * Encontre Pet - Database Layer v1.1.0
 * Modo DUAL: Firebase Firestore (principal) + REST API (fallback)
 * 
 * Estratégia:
 * 1. Tenta usar Firestore primeiro
 * 2. Se falhar, tenta REST API local
 * 3. Se REST também falhar (ex: Netlify sem backend), retorna dados do cache ou vazio
 * 4. Cache localStorage para performance offline
 * 
 * NOTA: Queries Firestore evitam índices compostos — filtragem em JS quando necessário
 */

const DB = (() => {

  const TABLES = {
    PETS: 'pets_perdidos',
    AVISTAMENTOS: 'avistamentos',
    NOTIFICACOES: 'notificacoes',
    USUARIOS: 'usuarios',
    ALERT_PRIVADO: 'alert_privado',
    CONVERSAS: 'conversas',
    FOTOS: 'fotos'
  };

  const COLLECTIONS = TABLES;

  const CACHE_PREFIX = 'encontrePet_cache_';
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h — permite uso offline significativo

  let useFirestore = false;
  const isLocalDevHost = (() => {
    try {
      const h = window?.location?.hostname || '';
      return h === 'localhost' || h === '127.0.0.1';
    } catch {
      return false;
    }
  })();
  let restAvailable = isLocalDevHost; // evita 405 em produção sem backend REST

  function init() {
    try {
      const fb = FirebaseConfig.init();
      useFirestore = fb.isAvailable;
    } catch (e) {
      console.warn('[DB] FirebaseConfig não disponível:', e.message);
      useFirestore = false;
    }
    console.log('[DB] Modo:', useFirestore ? '🔥 Firestore + REST fallback' : '📡 REST API');
    // Processar fila local de operações pendentes
    if (useFirestore) {
      setTimeout(() => processSyncQueue(), 3000);
    }
  }

  // ============================================================
  //  FIRESTORE OPERATIONS
  //  IMPORTANTE: Evita where() + orderBy() em campos diferentes
  //  para não exigir índices compostos. Filtragem/ordenação em JS.
  // ============================================================

  async function fsCreate(collection, data) {
    const db = FirebaseConfig.getDB();
    const sanitized = Security.sanitizeObject(data);
    sanitized.created_at = firebase.firestore.FieldValue.serverTimestamp();
    sanitized.updated_at = firebase.firestore.FieldValue.serverTimestamp();

    const ref = await db.collection(collection).add(sanitized);
    clearCache(collection);
    return { id: ref.id, ...sanitized };
  }

  async function fsGet(collection, id) {
    const db = FirebaseConfig.getDB();
    const doc = await db.collection(collection).doc(id).get();
    if (!doc.exists) throw new Error('Documento não encontrado');
    return { id: doc.id, ...doc.data() };
  }

  /**
   * Lista documentos do Firestore SEM índices compostos
   * - Se tiver filtros where, NÃO adiciona orderBy (ordena em JS)
   * - Se NÃO tiver filtros, pode usar orderBy normalmente
   * Isso evita o erro "The query requires an index"
   */
  async function fsList(collection, options = {}) {
    const db = FirebaseConfig.getDB();
    let query = db.collection(collection);

    const hasWhereFilters = options.where && options.where.length > 0;

    // Filtros where
    if (hasWhereFilters) {
      for (const [field, op, value] of options.where) {
        query = query.where(field, op, value);
      }
      // NÃO adiciona orderBy quando tem where — evita índice composto
    } else {
      // Sem filtros: pode ordenar livremente
      if (options.orderBy) {
        query = query.orderBy(options.orderBy, options.order || 'desc');
      }
      // Não usar orderBy('created_at') por padrão — documentos sem este campo causam problemas
    }

    // Limite (aumento para filtros JS posteriores)
    const limit = options.limit || 200;
    query = query.limit(limit);

    const snapshot = await query.get();
    let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Ordenação em JS se necessário (quando não pôde usar orderBy no Firestore)
    if (hasWhereFilters || !options.orderBy) {
      data.sort((a, b) => {
        const tA = a.created_at?.toMillis ? a.created_at.toMillis() : (a.created_at ? new Date(a.created_at).getTime() : 0);
        const tB = b.created_at?.toMillis ? b.created_at.toMillis() : (b.created_at ? new Date(b.created_at).getTime() : 0);
        return tB - tA; // desc
      });
    }

    setCache(collection, { data, total: data.length });
    return { data, total: data.length };
  }

  async function fsUpdate(collection, id, data) {
    const db = FirebaseConfig.getDB();
    const sanitized = Security.sanitizeObject(data);
    sanitized.updated_at = firebase.firestore.FieldValue.serverTimestamp();

    await db.collection(collection).doc(id).update(sanitized);
    clearCache(collection);
    return { id, ...sanitized };
  }

  async function fsDelete(collection, id) {
    const db = FirebaseConfig.getDB();
    await db.collection(collection).doc(id).delete();
    clearCache(collection);
  }

  // ============================================================
  //  REST API OPERATIONS (fallback)
  //  Retorna null se REST não estiver disponível (ex: Netlify)
  // ============================================================

  async function apiCreate(table, data) {
    if (!restAvailable) return null;
    try {
      const sanitized = Security.sanitizeObject(data);
      const response = await fetch(`tables/${table}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sanitized)
      });
      if (response.status === 404) { restAvailable = false; return null; }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      clearCache(table);
      return await response.json();
    } catch (err) {
      if (err.message.includes('404') || err.message.includes('Failed to fetch')) {
        restAvailable = false;
      }
      return null;
    }
  }

  async function apiGet(table, id) {
    if (!restAvailable) return null;
    try {
      const response = await fetch(`tables/${table}/${id}`);
      if (response.status === 404) { restAvailable = false; return null; }
      if (!response.ok) return null;
      return await response.json();
    } catch {
      restAvailable = false;
      return null;
    }
  }

  async function apiList(table, params = {}) {
    if (!restAvailable) return null;
    try {
      const query = new URLSearchParams({
        page: params.page || 1,
        limit: params.limit || 100,
        ...(params.search && { search: params.search }),
        ...(params.sort && { sort: params.sort })
      });
      const response = await fetch(`tables/${table}?${query}`);
      if (response.status === 404) { restAvailable = false; return null; }
      if (!response.ok) return null;
      const data = await response.json();
      setCache(table, data);
      return data;
    } catch {
      restAvailable = false;
      return null;
    }
  }

  async function apiUpdate(table, id, data) {
    if (!restAvailable) return null;
    try {
      const sanitized = Security.sanitizeObject(data);
      const response = await fetch(`tables/${table}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sanitized)
      });
      if (response.status === 404) { restAvailable = false; return null; }
      if (!response.ok) return null;
      clearCache(table);
      return await response.json();
    } catch {
      restAvailable = false;
      return null;
    }
  }

  async function apiDelete(table, id) {
    if (!restAvailable) return;
    try {
      const response = await fetch(`tables/${table}/${id}`, { method: 'DELETE' });
      if (response.status === 404) restAvailable = false;
      clearCache(table);
    } catch {
      restAvailable = false;
    }
  }

  // ============================================================
  //  UNIFIED OPERATIONS (Firestore → REST → Cache → vazio)
  // ============================================================

  async function create(collection, data) {
    // Tentar Firestore
    if (useFirestore) {
      try {
        return await fsCreate(collection, data);
      } catch (err) {
        console.warn('[DB] Firestore create falhou:', err.message);
      }
    }
    // Tentar REST
    const restResult = await apiCreate(collection, data);
    if (restResult) return restResult;
    // Se ambos falharam, salvar localmente
    const localId = 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const localRecord = { id: localId, ...data, _localOnly: true, created_at: new Date().toISOString() };
    saveToLocalQueue(collection, 'create', localRecord);
    return localRecord;
  }

  async function get(collection, id) {
    // Tentar Firestore
    if (useFirestore) {
      try {
        return await fsGet(collection, id);
      } catch (err) {
        console.warn('[DB] Firestore get falhou:', err.message);
      }
    }
    // Tentar REST
    const restResult = await apiGet(collection, id);
    if (restResult) return restResult;
    // Tentar cache
    const cached = getCache(collection);
    if (cached && cached.data) {
      const found = cached.data.find(d => d.id === id);
      if (found) return found;
    }
    throw new Error('Registro não encontrado');
  }

  async function list(collection, options = {}) {
    // Tentar Firestore
    if (useFirestore) {
      try {
        return await fsList(collection, options);
      } catch (err) {
        console.warn('[DB] Firestore list falhou:', err.message);
      }
    }
    // Tentar REST
    const restResult = await apiList(collection, {
      page: options.page || 1,
      limit: options.limit || 100,
      search: options.search,
      sort: options.sort || '-created_at'
    });
    if (restResult) return restResult;
    // Tentar cache
    const cached = getCache(collection);
    if (cached) {
      console.log('[DB] Usando dados do cache para', collection);
      return cached;
    }
    // Retornar vazio (não lançar erro)
    console.warn('[DB] Sem dados disponíveis para', collection);
    return { data: [], total: 0 };
  }

  async function update(collection, id, data) {
    // Tentar Firestore
    if (useFirestore) {
      try {
        return await fsUpdate(collection, id, data);
      } catch (err) {
        console.warn('[DB] Firestore update falhou:', err.message);
      }
    }
    // Tentar REST
    const restResult = await apiUpdate(collection, id, data);
    if (restResult) return restResult;
    // Salvar na fila local
    saveToLocalQueue(collection, 'update', { id, ...data });
    return { id, ...data };
  }

  async function remove(collection, id) {
    if (useFirestore) {
      try {
        return await fsDelete(collection, id);
      } catch (err) {
        console.warn('[DB] Firestore delete falhou:', err.message);
      }
    }
    await apiDelete(collection, id);
  }

  // ============================================================
  //  FILA LOCAL (para quando Firestore e REST falham)
  // ============================================================

  function saveToLocalQueue(collection, action, data) {
    try {
      const queue = JSON.parse(localStorage.getItem('encontrePet_syncQueue') || '[]');
      queue.push({ collection, action, data, timestamp: Date.now() });
      localStorage.setItem('encontrePet_syncQueue', JSON.stringify(queue));
      console.log('[DB] 📝 Salvo na fila local para sync posterior');
    } catch (e) { /* localStorage full */ }
  }

  /**
   * Tenta processar a fila local de operações pendentes.
   * Chamado automaticamente quando Firestore fica disponível.
   */
  async function processSyncQueue() {
    if (!useFirestore) return;
    let queue;
    try {
      queue = JSON.parse(localStorage.getItem('encontrePet_syncQueue') || '[]');
    } catch { return; }
    if (queue.length === 0) return;

    console.log(`[DB] 🔄 Processando ${queue.length} operações pendentes...`);
    const remaining = [];
    for (const item of queue) {
      try {
        if (item.action === 'create') {
          await create(item.collection, item.data);
        } else if (item.action === 'update' && item.data?.id) {
          const { id, ...rest } = item.data;
          await update(item.collection, id, rest);
        }
        console.log(`[DB] ✅ Sync: ${item.action} em ${item.collection}`);
      } catch (err) {
        console.warn(`[DB] ❌ Sync falhou: ${item.action} em ${item.collection}:`, err.message);
        // Manter na fila apenas se o erro não for 'not-found' (dado já removido)
        if (!err.message?.includes('not-found')) {
          remaining.push(item);
        }
      }
    }
    localStorage.setItem('encontrePet_syncQueue', JSON.stringify(remaining));
    if (remaining.length === 0) {
      console.log('[DB] ✅ Fila local processada com sucesso.');
    } else {
      console.warn(`[DB] ${remaining.length} operações ainda pendentes.`);
    }
  }

  // ============================================================
  //  PETS PERDIDOS
  // ============================================================

  async function reportarPetPerdido(data) {
    Security.checkRateLimit('report_pet', 3, 300000);
    Security.validateReportData(data);

    // [FIX C12] Garante que Firebase Auth UID esteja pronto ANTES de montar o
    // record. Sem isso, race condition fazia o doc ser salvo com
    // owner_firebase_uid='' e depois o proprio dono nao conseguia ler/atualizar
    // (Firestore Rules: isOwner checa owner_firebase_uid == auth.uid).
    let ensuredFirebaseUid = '';
    if (typeof FirebaseConfig !== 'undefined' && FirebaseConfig.waitForAuthUID) {
      try { ensuredFirebaseUid = await FirebaseConfig.waitForAuthUID(3000); } catch {}
    }

    const raio = GeoUtils.getSearchRadius(data.tipo_animal);
    const settings = Auth.getUserSettings();

    const pubLoc = Security.getPublicLocation(
      data.latitude, data.longitude, data.endereco, settings
    );

    // Documento PÚBLICO — sem dados sensíveis (LGPD)
    const record = {
      tipo_animal: data.tipo_animal || 'cao',
      subtipo_animal: Security.sanitize(data.subtipo_animal || ''),
      nome_pet: Security.sanitize(data.nome_pet || ''),
      raca: Security.sanitize(data.raca || ''),
      cor: data.cor || '',
      porte: data.porte || '',
      sexo: data.sexo || '',
      foto_comprimida: data.foto_comprimida || '',
      // Thumbnail pequeno (~10KB) fica no doc para o feed; a imagem cheia vai
      // pro Storage e o base64 grande é removido do doc após o upload (custo).
      foto_thumb: data.foto_thumb || '',
      foto_hash: data.foto_hash || '',
      embedding: data.embedding || null,
      // Apenas localização pública (ofuscada)
      latitude_publica: pubLoc.latitude,
      longitude_publica: pubLoc.longitude,
      endereco_publico: pubLoc.endereco,
      localizacao_aproximada: pubLoc.isApproximate,
      descricao: Security.sanitize(data.descricao || ''),
      recompensa: Security.sanitize(data.recompensa || ''),
      tem_recompensa: data.tem_recompensa || false,
      contato_nome: Security.sanitize(data.contato_nome || ''),
      // Telefone público (opt-in do tutor)
      telefone_publico: data.telefone_publico_ativo ? Security.sanitizePhone(data.contato_telefone || '') : '',
      telefone_publico_ativo: !!data.telefone_publico_ativo,
      // E-mail público (opt-in do tutor)
      contato_email_publico: data.email_publico_ativo ? Security.sanitizeEmail(data.contato_email || Auth.getUserData()?.email || '') : '',
      email_publico_ativo: !!data.email_publico_ativo,
      status: 'ativo',
      cadastro_completo: data.cadastro_completo || false,
      raio_busca_km: raio,
      data_perda: data.data_perda || new Date().toISOString().split('T')[0],
      data_reporte: new Date().toISOString(),
      visualizacoes: 0,
      // Hash será gerado server-side via Cloud Function — não enviar do client
      imageHashProcessed: false,
      imageStoragePath: data.imageStoragePath || '',
      imageStorageUrl: data.imageStorageUrl || '',
      linkedToCaseId: data.linkedToCaseId || '',
      suspiciousFlag: data.suspiciousFlag || false,
      suspiciousReason: Security.sanitize(data.suspiciousReason || ''),
      flaggedByUid: data.flaggedByUid || '',
      // [S-08] owner_firebase_uid NÃO vai mais no doc público — vive apenas no
      // alert_privado (savePrivateAlertData), fonte de ownership das rules.
      similarCandidates: Array.isArray(data.similarCandidates) ? data.similarCandidates.slice(0, 5) : [],
      owner_uid: Auth.getUID()
    };

    const result = await create(TABLES.PETS, record);
    _feedCache.pets.at = 0; // novo alerta aparece no próximo load do feed

    // Salvar dados PRIVADOS em collection separada (LGPD)
    if (result?.id) {
      const profilePhone = Auth.getUserData?.()?.profile?.telefone || '';
      await savePrivateAlertData('pets_perdidos', result.id, {
        contato_telefone: Security.sanitizePhone(data.contato_telefone || profilePhone),
        contato_email: Security.sanitizeEmail(data.contato_email || Auth.getUserData?.()?.email || ''),
        contato_nome: Security.sanitize(data.contato_nome || ''),
        endereco_privado: Security.sanitize(data.endereco || ''),
        latitude_privada: data.latitude || 0,
        longitude_privada: data.longitude || 0
      });
    }

    // Foto cheia sai do doc público em background (custo — não bloqueia o retorno)
    if (result?.id && data.foto_comprimida) {
      offloadFullPhoto(TABLES.PETS, result.id, data.foto_comprimida, record.owner_uid);
    }

    saveMyReport(result.id, 'pet_perdido');
    return result;
  }

  async function completarCadastro(petId, data) {
    // Dados públicos
    await update(TABLES.PETS, petId, {
      nome_pet: Security.sanitize(data.nome_pet),
      raca: Security.sanitize(data.raca),
      sexo: data.sexo,
      data_perda: data.data_perda,
      descricao: Security.sanitize(data.descricao),
      contato_nome: Security.sanitize(data.contato_nome),
      cadastro_completo: true
    });
    // Dados privados (email do tutor)
    if (data.contato_email) {
      await savePrivateAlertData('pets_perdidos', petId, {
        contato_email: Security.sanitizeEmail(data.contato_email)
      });
    }
  }

  /**
   * Grava um evento na coleção de auditoria LGPD (lgpd_access_log).
   * Rules: create liberado para autenticados; ninguém lê pelo cliente.
   * Best-effort — nunca deve bloquear o fluxo principal.
   */
  async function registrarLogLGPD(tipo, dados = {}) {
    try {
      if (!useFirestore) return;
      const db = FirebaseConfig.getDB();
      await db.collection('lgpd_access_log').add({
        tipo,
        ...dados,
        actor_firebase_uid: FirebaseConfig.getFirebaseUID?.() || '',
        actor_uid: Auth.getUID() || '',
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      console.warn('[DB] registrarLogLGPD falhou:', e.message);
    }
  }

  async function marcarEncontrado(petId, feedback = {}) {
    const desfecho = feedback.desfecho || 'encontrado_vivo';
    const statusMap = {
      'encontrado_vivo': 'encontrado',
      'encontrado_morto': 'encerrado_falecido',
      'desistencia': 'encerrado_desistencia'
    };

    const baseFeedback = {
      feedback_como_encontrou: feedback.como || '',
      feedback_app_ajudou: feedback.appAjudou || false,
      feedback_mensagem: Security.sanitize(feedback.mensagem || ''),
      feedback_nota: feedback.nota || 0
    };

    // Confirmação BILATERAL (North Star): quando o reencontro foi com uma
    // contraparte conhecida (avistador de um avistamento vinculado), o alerta
    // entra em 'aguardando_confirmacao' e a contraparte confirma para virar
    // 'reuniao_confirmada'. Sem contraparte → fluxo unilateral (como antes).
    const myFbUid = FirebaseConfig.getFirebaseUID?.() || '';
    const temContraparte = desfecho === 'encontrado_vivo'
      && !!feedback.avistadorFirebaseUid
      && feedback.avistadorFirebaseUid !== myFbUid;

    if (temContraparte) {
      const avistamentoId = feedback.avistamentoId || '';
      const reuniao = {
        marcado_por_uid: Auth.getUID() || '',
        marcado_por_firebase_uid: myFbUid,
        marcado_em: new Date().toISOString(),
        avistamento_id: avistamentoId,
        conversa_id: avistamentoId ? `${petId}_${avistamentoId}` : '',
        avistador_uid: feedback.avistadorUid || '',
        avistador_firebase_uid: feedback.avistadorFirebaseUid,
        confirmado_por_uid: '',
        confirmado_por_firebase_uid: '',
        confirmado_em: '',
        confirmacao_unilateral: false
      };
      const res = await update(TABLES.PETS, petId, {
        status: 'aguardando_confirmacao',
        desfecho: 'encontrado_vivo',
        reuniao,
        ...baseFeedback
      });
      // Notifica a contraparte (avistador) para confirmar o reencontro.
      try {
        await criarNotificacao({
          tipo: 'confirmar_reuniao',
          pet_perdido_id: petId,
          pet_nome: feedback.petNome || '',
          avistamento_id: avistamentoId,
          conversaId: reuniao.conversa_id,
          lida: false,
          destinatario_uid: feedback.avistadorUid || '',
          destinatario_firebase_uid: feedback.avistadorFirebaseUid,
          data: new Date().toISOString()
        });
      } catch (e) { console.warn('[DB] notif confirmar_reuniao falhou:', e.message); }
      return res;
    }

    // Fluxo unilateral (sem contraparte conhecida) — comportamento histórico.
    const res = await update(TABLES.PETS, petId, {
      status: statusMap[desfecho] || 'encontrado',
      desfecho: desfecho,
      data_encerrado: new Date().toISOString(),
      ...baseFeedback
    });
    if (desfecho === 'encontrado_vivo') {
      registrarLogLGPD('pet_encontrado', { petId, sem_contraparte: true });
    }
    return res;
  }

  /**
   * A contraparte (avistador designado em reuniao.avistador_firebase_uid)
   * confirma que o reencontro aconteceu → status vira 'reuniao_confirmada'
   * (alimenta a North Star). Rules: canConfirmReunion permite a escrita cruzada
   * apenas do avistador designado e só dos campos de encerramento.
   */
  async function confirmarReuniao(petId) {
    const pet = await get(TABLES.PETS, petId);
    if (!pet) throw new Error('Pet não encontrado.');
    if (pet.status !== 'aguardando_confirmacao') {
      throw new Error('Este reencontro não está aguardando confirmação.');
    }
    const myFbUid = FirebaseConfig.getFirebaseUID?.() || '';
    const reuniao = { ...(pet.reuniao || {}) };
    reuniao.confirmado_por_uid = Auth.getUID() || '';
    reuniao.confirmado_por_firebase_uid = myFbUid;
    reuniao.confirmado_em = new Date().toISOString();
    reuniao.confirmacao_unilateral = false;

    const res = await update(TABLES.PETS, petId, {
      status: 'encontrado',
      desfecho: 'reuniao_confirmada',
      data_encerrado: new Date().toISOString(),
      reuniao
    });
    registrarLogLGPD('pet_encontrado', {
      petId,
      avistamentoId: reuniao.avistamento_id || '',
      bilateral: true
    });
    // Notifica o tutor que a reunião foi confirmada.
    try {
      await criarNotificacao({
        tipo: 'reuniao_confirmada',
        pet_perdido_id: petId,
        pet_nome: pet.nome_pet || '',
        lida: false,
        destinatario_uid: reuniao.marcado_por_uid || pet.owner_uid || '',
        destinatario_firebase_uid: reuniao.marcado_por_firebase_uid || pet.owner_firebase_uid || '',
        data: new Date().toISOString()
      });
    } catch (e) { console.warn('[DB] notif reuniao_confirmada falhou:', e.message); }
    return res;
  }

  /**
   * Reabre um reporte encerrado por desistência.
   * Só funciona se o desfecho for 'desistencia'.
   * @param {string} petId
   */
  async function reabrirReporte(petId) {
    const pet = await get(TABLES.PETS, petId);
    if (!pet || pet.desfecho !== 'desistencia') {
      throw new Error('Somente reportes encerrados por desistência podem ser reabertos.');
    }
    const updateData = {
      status: 'ativo',
      desfecho: null,
      data_encerrado: null,
      reaberto_em: new Date().toISOString()
    };
    return await update(TABLES.PETS, petId, updateData);
  }

  /**
   * Lista pets ativos — usa where('status') SEM orderBy no Firestore
   * para evitar necessidade de índice composto.
   * Ordenação feita em JS pelo fsList().
   */
  // ============================================================
  //  CACHE TTL DO FEED (custo)
  //  O feed, o matching de IA e o polling de novidades pedem a MESMA
  //  lista — compartilham um único get() por até FEED_CACHE_TTL_MS,
  //  em vez de cada chamador pagar os reads de novo.
  // ============================================================
  const FEED_CACHE_TTL_MS = 60 * 1000;
  const _feedCache = { pets: { at: 0, promise: null }, avist: { at: 0, promise: null } };

  function cachedFeedFetch(slot, fetcher, force) {
    const c = _feedCache[slot];
    const now = Date.now();
    if (!force && c.promise && (now - c.at) < FEED_CACHE_TTL_MS) return c.promise;
    c.at = now;
    c.promise = fetcher().catch(err => { c.at = 0; c.promise = null; throw err; });
    return c.promise;
  }

  async function listarPetsAtivos(opts = {}) {
    return cachedFeedFetch('pets', () => _fetchPetsAtivos(), opts.force === true);
  }

  async function _fetchPetsAtivos() {
    if (useFirestore) {
      try {
        return await fsList(TABLES.PETS, {
          where: [['status', '==', 'ativo']],
          limit: 100
        });
      } catch (err) {
        console.warn('[DB] Firestore list pets falhou:', err.message);
      }
    }
    // Fallback: listar todos e filtrar em JS
    const result = await list(TABLES.PETS, { limit: 200 });
    const ativos = (result.data || []).filter(p => p.status === 'ativo');
    return { data: ativos, total: ativos.length };
  }

  async function listarPetsPorProximidade(lat, lng, maxRadius = 10) {
    const result = await listarPetsAtivos();
    const pets = result.data || [];

    return GeoUtils.filterByProximity(
      pets.map(p => ({
        ...p,
        latitude: p.latitude_publica || p.latitude,
        longitude: p.longitude_publica || p.longitude
      })),
      lat, lng, maxRadius
    );
  }

  // ============================================================
  //  AVISTAMENTOS
  // ============================================================

  async function reportarAvistamento(data) {
    Security.checkRateLimit('report_sighting', 5, 300000);

    // [FIX C12] Mesma garantia de owner_firebase_uid valido (ver reportarPetPerdido)
    let ensuredFirebaseUid = '';
    if (typeof FirebaseConfig !== 'undefined' && FirebaseConfig.waitForAuthUID) {
      try { ensuredFirebaseUid = await FirebaseConfig.waitForAuthUID(3000); } catch {}
    }

    const settings = Auth.getUserSettings();
    const pubLoc = Security.getPublicLocation(
      data.latitude, data.longitude, data.endereco || '', settings
    );

    // Documento PÚBLICO — sem dados sensíveis (LGPD)
    const record = {
      pet_perdido_id: data.pet_perdido_id || data.matchedLostPetId || '',
      tipo_animal: data.tipo_animal || 'cao',
      subtipo_animal: Security.sanitize(data.subtipo_animal || ''),
      foto_comprimida: data.foto_comprimida || '',
      // Thumbnail pequeno para o feed; base64 grande sai do doc após upload
      foto_thumb: data.foto_thumb || '',
      foto_hash: data.foto_hash || '',
      embedding: data.embedding || null,
      // Apenas localização pública (ofuscada)
      latitude_publica: pubLoc.latitude,
      longitude_publica: pubLoc.longitude,
      endereco_publico: pubLoc.endereco,
      localizacao_aproximada: pubLoc.isApproximate,
      descricao: Security.sanitize(data.descricao || ''),
      reportado_por: Security.sanitize(data.reportado_por || ''),
      // Telefone público (opt-in do observador)
      telefone_publico: data.telefone_publico_ativo ? Security.sanitizePhone(data.contato || '') : '',
      telefone_publico_ativo: !!data.telefone_publico_ativo,
      match_percentual: data.match_percentual || 0,
      status: 'pendente',
      cor: data.cor || '',
      porte: data.porte || '',
      data_avistamento: new Date().toISOString(),
      // Vinculação opcional a pet perdido (match IA)
      matchedLostPetId: data.matchedLostPetId || '',
      matchedScore: data.matchedScore || 0,
      match_score: data.matchedScore || data.match_score || 0,
      matchedEngine: data.matchedEngine || '',
      // Hash será gerado server-side via Cloud Function
      imageHashProcessed: false,
      imageStoragePath: data.imageStoragePath || '',
      imageStorageUrl: data.imageStorageUrl || '',
      linkedToCaseId: data.linkedToCaseId || '',
      suspiciousFlag: data.suspiciousFlag || false,
      suspiciousReason: Security.sanitize(data.suspiciousReason || ''),
      flaggedByUid: data.flaggedByUid || '',
      // [S-08] owner_firebase_uid só no alert_privado (ownership das rules)
      similarCandidates: Array.isArray(data.similarCandidates) ? data.similarCandidates.slice(0, 5) : [],
      owner_uid: Auth.getUID()
    };

    const result = await create(TABLES.AVISTAMENTOS, record);
    _feedCache.avist.at = 0; // novo avistamento aparece no próximo load

    // Salvar dados PRIVADOS em collection separada (LGPD)
    if (result?.id) {
      // Se o avistamento está vinculado a um pet, buscar o dono do pet
      // para permitir acesso cruzado via Firestore Rules (sem Cloud Function)
      const linkedPetId = record.pet_perdido_id || record.matchedLostPetId || '';
      // Fallback: UID passado diretamente pelo client quando disponível (evita falha se pet não tem o campo)
      let linkedPetOwnerFirebaseUid = data.matchedPetOwnerFirebaseUid || '';
      if (linkedPetId && useFirestore) {
        try {
          const db = FirebaseConfig.getDB();
          const petDoc = await db.collection(TABLES.PETS).doc(linkedPetId).get();
          if (petDoc.exists) {
            // Preferir valor do Firestore; cair no fallback do client apenas se vazio
            linkedPetOwnerFirebaseUid = petDoc.data().owner_firebase_uid || linkedPetOwnerFirebaseUid;
          }
        } catch (e) { /* não bloqueia o salvamento */ }
      }

      const sighterProfilePhone = Auth.getUserData?.()?.profile?.telefone || '';
      await savePrivateAlertData('avistamentos', result.id, {
        contato_telefone: Security.sanitizePhone(data.contato || sighterProfilePhone),
        contato_email: Security.sanitizeEmail(Auth.getUserData?.()?.email || ''),
        reportado_por: Security.sanitize(data.reportado_por || Auth.getUserData?.()?.nome || ''),
        endereco_privado: Security.sanitize(data.endereco || ''),
        latitude_privada: data.latitude || 0,
        longitude_privada: data.longitude || 0,
        linked_pet_owner_firebase_uid: linkedPetOwnerFirebaseUid
      });

      // Criar autorização imutável para que o avistador possa ler
      // os dados privados do pet (Firestore Rules verificam este doc)
      if (linkedPetId && linkedPetOwnerFirebaseUid) {
        await createSighterAuthorization(linkedPetId, linkedPetOwnerFirebaseUid, result.id).catch(() => {});
      }
    }

    // Foto cheia sai do doc público em background (custo — não bloqueia o retorno)
    if (result?.id && data.foto_comprimida) {
      offloadFullPhoto(TABLES.AVISTAMENTOS, result.id, data.foto_comprimida, record.owner_uid);
    }

    saveMyReport(result.id, 'avistamento');

    // Substituto do trigger onAvistamentoCreated (sem Cloud Functions):
    // o backend Netlify processa notificações de match, conversa e vínculos
    // LGPD. Fire-and-forget com 1 retry; a scheduled sweep-avistamentos
    // cobre quem fechar o app antes do retry. Idempotente no servidor.
    if (result?.id) {
      triggerProcessAvistamento(result.id);
    }
    return result;
  }

  // ====== FOTO CHEIA FORA DO DOC PÚBLICO (custo) ======
  // O feed baixa o doc público inteiro; com o base64 (≤120KB) dentro dele a
  // cota grátis de egress acabava com poucas dezenas de aberturas/dia. O doc
  // público fica só com foto_thumb (~10KB) e a foto cheia vai para:
  //   • Firebase Storage, se AppConfig.USE_FIREBASE_STORAGE (exige Blaze);
  //   • senão fotos/{colecao}_{id} — mesmo ID do alert_privado, que as rules
  //     usam para amarrar a gravação ao dono. Lida só no detalhe (+1 read).
  // Se tudo falhar, o base64 fica no doc público (comportamento antigo).
  function offloadFullPhoto(collection, id, dataUrl, ownerUid) {
    if (!useFirestore) return;
    (async () => {
      try {
        let patch = null;
        if (AppConfig.USE_FIREBASE_STORAGE && FirebaseConfig.isStorageReady?.() && FirebaseConfig.getFirebaseUID()) {
          try {
            const upload = await FirebaseConfig.uploadAlertImage({ alertId: id, dataUrl, collection, ownerUid });
            patch = { imageStoragePath: upload.path, imageStorageUrl: upload.downloadURL, imageHashProcessed: false };
          } catch (err) {
            console.warn('[DB] Upload Storage falhou, usando fotos/:', err.message);
          }
        }
        if (!patch) {
          await FirebaseConfig.getDB().collection(TABLES.FOTOS).doc(`${collection}_${id}`)
            .set({ dataUrl, created_at: new Date().toISOString() });
          patch = { foto_full_doc: true };
        }
        await update(collection, id, { ...patch, foto_comprimida: '' });
      } catch (err) {
        console.warn('[DB] offloadFullPhoto falhou (base64 permanece no doc):', err.message);
      }
    })();
  }

  async function getFullPhoto(collection, id) {
    if (!useFirestore || !id) return '';
    try {
      const snap = await FirebaseConfig.getDB().collection(TABLES.FOTOS).doc(`${collection}_${id}`).get();
      return snap.exists ? (snap.data()?.dataUrl || '') : '';
    } catch (err) {
      console.warn('[DB] getFullPhoto falhou:', err.message);
      return '';
    }
  }

  function triggerProcessAvistamento(avistamentoId, attempt = 1) {
    const MAX_ATTEMPTS = 2;
    (async () => {
      try {
        const functions = FirebaseConfig.getFunctions?.();
        if (!functions?.httpsCallable) return;
        await functions.httpsCallable('processAvistamento')({ avistamentoId });
        console.log('[DB] Avistamento processado pelo backend:', avistamentoId);
      } catch (err) {
        console.warn(`[DB] processAvistamento falhou (tentativa ${attempt}):`, err.message);
        if (attempt < MAX_ATTEMPTS) {
          setTimeout(() => triggerProcessAvistamento(avistamentoId, attempt + 1), 5000);
        }
        // Sem pânico: sweep-avistamentos (6/6h) reprocessa pendentes.
      }
    })();
  }

  async function listarAvistamentos(opts = {}) {
    return cachedFeedFetch('avist', () => list(TABLES.AVISTAMENTOS, { limit: 50 }), opts.force === true);
  }

  async function listRecentAlertsForSimilarity(tipoAnimal, recentDays = 30, limitPerCollection = 250) {
    try {
      const minTs = Date.now() - (recentDays * 24 * 60 * 60 * 1000);

      const [petsResult, avistResult] = await Promise.all([
        list(TABLES.PETS, { limit: limitPerCollection }),
        list(TABLES.AVISTAMENTOS, { limit: limitPerCollection })
      ]);

      const toTs = (value) => {
        if (!value) return 0;
        if (typeof value === 'number') return value;
        if (value?.toMillis) return value.toMillis();
        if (typeof value === 'string') {
          const parsed = Date.parse(value);
          return Number.isNaN(parsed) ? 0 : parsed;
        }
        return 0;
      };

      const normalize = (item, alertType) => {
        const createdAt = item.created_at || item.data_avistamento || item.data_perda;
        return {
          id: item.id,
          alertType,
          tipo_animal: item.tipo_animal,
          imageHash: item.imageHash || item.foto_hash || '',
          foto_hash: item.foto_hash || item.imageHash || '',
          latitude: Number(item.latitude_publica || item.latitude || 0),
          longitude: Number(item.longitude_publica || item.longitude || 0),
          owner_uid: item.owner_uid || '',
          contato: item.contato || item.contato_telefone || '',
          contato_telefone: item.contato_telefone || item.contato || '',
          nome_pet: item.nome_pet || '',
          descricao: item.descricao || '',
          endereco: item.endereco_publico || item.endereco || '',
          created_at: createdAt,
          created_at_ts: toTs(createdAt)
        };
      };

      const all = [
        ...((petsResult.data || []).map(item => normalize(item, 'pet_perdido'))),
        ...((avistResult.data || []).map(item => normalize(item, 'avistamento')))
      ];

      return all
        .filter(item => item.tipo_animal === tipoAnimal)
        .filter(item => item.imageHash)
        .filter(item => item.created_at_ts >= minTs)
        .filter(item => item.latitude && item.longitude)
        .sort((a, b) => b.created_at_ts - a.created_at_ts);
    } catch (err) {
      console.error('[DB] listRecentAlertsForSimilarity error:', err);
      return [];
    }
  }

  function watchAlertDocument(alertType, alertId, onChange) {
    const collection = alertType === 'pet_perdido' ? TABLES.PETS : TABLES.AVISTAMENTOS;
    if (!alertId || typeof onChange !== 'function') return () => {};

    if (useFirestore) {
      try {
        const db = FirebaseConfig.getDB();
        const unsubscribe = db.collection(collection).doc(alertId).onSnapshot(
          (doc) => {
            if (!doc?.exists) return;
            onChange({ id: doc.id, ...doc.data() });
          },
          (err) => {
            console.error('[DB] watchAlertDocument snapshot error:', err);
          }
        );
        return () => {
          try { unsubscribe?.(); } catch {}
        };
      } catch (err) {
        console.error('[DB] watchAlertDocument init error:', err);
      }
    }

    let active = true;
    const loop = async () => {
      while (active) {
        try {
          const alert = await get(collection, alertId);
          if (alert) onChange(alert);
        } catch (err) {
          console.error('[DB] watchAlertDocument polling error:', err);
        }
        await new Promise(resolve => setTimeout(resolve, 2500));
      }
    };
    loop();
    return () => { active = false; };
  }

  // ============================================================
  //  DADOS PRIVADOS (LGPD) — Collection alert_privado
  // ============================================================

  /**
   * Salva dados sensíveis em collection separada (alert_privado).
   * O docId segue o padrão: {colecao}_{alertId}
   * Apenas o owner pode ler/escrever (via Firestore Rules).
   * @param {string} colecao - 'pets_perdidos' ou 'avistamentos'
   * @param {string} alertId - ID do documento público
   * @param {Object} privateData - { contato_telefone, contato_email, endereco_privado, latitude_privada, longitude_privada }
   */
  async function savePrivateAlertData(colecao, alertId, privateData) {
    const docId = `${colecao}_${alertId}`;
    // [FIX C12] Aguarda Firebase UID antes de salvar para evitar payload com
    // owner_firebase_uid='' (que tornava o doc privado inacessivel ao proprio dono).
    let ensuredFirebaseUid = FirebaseConfig.getFirebaseUID?.() || '';
    if (!ensuredFirebaseUid && FirebaseConfig.waitForAuthUID) {
      try { ensuredFirebaseUid = await FirebaseConfig.waitForAuthUID(3000); } catch {}
    }
    const payload = {
      owner_firebase_uid: ensuredFirebaseUid || '',
      owner_uid: Auth.getUID(),
      contato_telefone: privateData.contato_telefone || '',
      contato_email: privateData.contato_email || '',
      contato_nome: privateData.contato_nome || '',
      reportado_por: privateData.reportado_por || '',
      endereco_privado: privateData.endereco_privado || '',
      latitude_privada: privateData.latitude_privada || 0,
      longitude_privada: privateData.longitude_privada || 0,
      alert_collection: colecao,
      alert_id: alertId,
      createdAt: new Date().toISOString()
    };
    // Metadado usado apenas pelo backend/auditoria; clientes não leem dados privados de terceiros.
    if (privateData.linked_pet_owner_firebase_uid !== undefined) {
      payload.linked_pet_owner_firebase_uid = privateData.linked_pet_owner_firebase_uid || '';
    }

    if (useFirestore) {
      try {
        const db = FirebaseConfig.getDB();
        await db.collection(TABLES.ALERT_PRIVADO).doc(docId).set(
          Security.sanitizeObject(payload),
          { merge: true }
        );
        console.log('[DB] Dados privados salvos (LGPD):', docId);
        return;
      } catch (err) {
        console.warn('[DB] Firestore alert_privado falhou:', err.message);
      }
    }
    // Fallback local
    try {
      const queue = JSON.parse(localStorage.getItem('encontrePet_privateData') || '{}');
      queue[docId] = payload;
      localStorage.setItem('encontrePet_privateData', JSON.stringify(queue));
      console.log('[DB] Dados privados salvos localmente (LGPD):', docId);
    } catch (e) { /* localStorage full */ }
  }

  /**
   * Atualiza apenas o telefone de contato em alert_privado sem sobrescrever outros campos.
   * Chamado quando o usuário salva um novo telefone no perfil.
   * @param {string} colecao - 'pets_perdidos' ou 'avistamentos'
   * @param {string} alertId - ID do documento público
   * @param {string} telefone - número normalizado
   */
  async function patchPrivateAlertPhone(colecao, alertId, telefone) {
    const docId = `${colecao}_${alertId}`;
    if (!useFirestore) return;
    try {
      const db = FirebaseConfig.getDB();
      await db.collection(TABLES.ALERT_PRIVADO).doc(docId).update({
        contato_telefone: Security.sanitizePhone(telefone)
      });
    } catch (e) {
      console.warn('[DB] patchPrivateAlertPhone falhou:', docId, e.message);
    }
  }

  /**
   * Busca dados privados de um alerta (apenas owner pode acessar via rules).
   * @param {string} colecao - 'pets_perdidos' ou 'avistamentos'
   * @param {string} alertId - ID do documento público
   * @returns {Object|null}
   */
  async function getPrivateAlertData(colecao, alertId) {
    const docId = `${colecao}_${alertId}`;
    if (useFirestore) {
      try {
        const db = FirebaseConfig.getDB();
        const doc = await db.collection(TABLES.ALERT_PRIVADO).doc(docId).get();
        if (doc.exists) return { id: doc.id, ...doc.data() };
      } catch (err) {
        // [FIX C12] permission-denied aqui geralmente significa que o doc foi
        // criado antes do C12 com owner_firebase_uid='' e o request.auth.uid
        // atual nao bate. Loga como info (nao erro vermelho) para nao poluir
        // o console — a UI vai mostrar "dados privados indisponiveis" mesmo.
        if (err.code === 'permission-denied') {
          console.info('[DB] alert_privado inacessivel (provavel doc legado pre-C12):', docId);
        } else {
          console.warn('[DB] getPrivateAlertData falhou:', err.message);
        }
      }
    }
    // Fallback local
    try {
      const queue = JSON.parse(localStorage.getItem('encontrePet_privateData') || '{}');
      return queue[docId] || null;
    } catch { return null; }
  }

  // ============================================================
  //  NOTIFICAÇÕES
  // ============================================================

  async function criarNotificacao(data) {
    // Garante destinatario_uid/destinatario_firebase_uid para as regras S-02.
    const enriched = { ...data };
    if (!enriched.destinatario_uid) {
      enriched.destinatario_uid = enriched.owner_uid || Auth.getUID() || '';
    }

    if (!enriched.destinatario_firebase_uid) {
      let firebaseUid = enriched.owner_firebase_uid || '';
      if (!firebaseUid) {
        // [FIX C12] Aguarda Firebase UID se necessario antes de salvar a notificacao.
        firebaseUid = FirebaseConfig.getFirebaseUID?.() || '';
        if (!firebaseUid && FirebaseConfig.waitForAuthUID) {
          try { firebaseUid = await FirebaseConfig.waitForAuthUID(2000); } catch {}
        }
      }
      // So preenche automaticamente quando for notificacao para o proprio usuario.
      if (enriched.destinatario_uid === Auth.getUID()) {
        enriched.destinatario_firebase_uid = firebaseUid;
      }
    }

    return await create(TABLES.NOTIFICACOES, Security.sanitizeObject(enriched));
  }

  async function listarNotificacoes() {
    const firebaseUid = FirebaseConfig.getFirebaseUID?.() || '';
    const uid = Auth.getUID();
    if (useFirestore && (firebaseUid || uid)) {
      try {
        const db = FirebaseConfig.getDB();
        const merged = new Map();
        // Query 1: por firebase_uid
        if (firebaseUid) {
          const snap1 = await db.collection(TABLES.NOTIFICACOES)
            .where('destinatario_firebase_uid', '==', firebaseUid).limit(200).get();
          snap1.docs.forEach(d => merged.set(d.id, { id: d.id, ...d.data() }));
        }
        // Query 2: por destinatario_uid. A rule só libera essa query quando o
        // destinatario_uid É o Firebase Auth UID; com o ID do app (u_xxx/anon_xxx)
        // ela é sempre negada — e, no mesmo try, descartava o resultado da
        // Query 1 (a tela de notificações ficava vazia para todos).
        if (uid && uid === firebaseUid) {
          try {
            const snap2 = await db.collection(TABLES.NOTIFICACOES)
              .where('destinatario_uid', '==', uid).limit(200).get();
            snap2.docs.forEach(d => merged.set(d.id, { id: d.id, ...d.data() }));
          } catch (e2) {
            console.warn('[DB] listarNotificacoes (destinatario_uid) negada:', e2.message);
          }
        }
        const data = [...merged.values()];
        return { data, total: data.length };
      } catch (err) {
        console.warn('[DB] listarNotificacoes Firestore falhou:', err.message);
      }
    }
    const restResult = await apiList(TABLES.NOTIFICACOES, { limit: 200 });
    if (restResult) return restResult;
    console.warn('[DB] Sem dados disponíveis para notificacoes');
    return { data: [], total: 0 };
  }

  async function marcarNotificacaoLida(notifId) {
    return await update(TABLES.NOTIFICACOES, notifId, { lida: true });
  }

  // ============================================================
  //  CHAT INTERNO
  // ============================================================

  async function getConversa(conversaId) {
    if (!conversaId) throw new Error('conversaId obrigatorio.');
    return await get(TABLES.CONVERSAS, conversaId);
  }

  function watchMensagensConversa(conversaId, onChange) {
    if (!useFirestore || !conversaId) return () => {};
    try {
      const db = FirebaseConfig.getDB();
      return db.collection(TABLES.CONVERSAS).doc(conversaId)
        .collection('mensagens')
        .orderBy('createdAt', 'asc')
        .limit(100)
        .onSnapshot(
          snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
          err => console.warn('[DB] watchMensagensConversa error:', err.message)
        );
    } catch (err) {
      console.warn('[DB] watchMensagensConversa init error:', err.message);
      return () => {};
    }
  }

  async function enviarMensagemConversa(conversaId, texto) {
    if (!useFirestore) throw new Error('Chat indisponível offline.');
    const cleanText = Security.sanitize(String(texto || '').trim()).slice(0, 1000);
    if (!cleanText) throw new Error('Mensagem vazia.');

    const db = FirebaseConfig.getDB();
    const conversaRef = db.collection(TABLES.CONVERSAS).doc(conversaId);
    const authorFirebaseUid = FirebaseConfig.getFirebaseUID?.() || '';
    const authorUid = Auth.getUID() || '';
    const authorName = Auth.getUserData?.()?.displayName || Auth.getUserData?.()?.nome || 'Usuário';

    await conversaRef.collection('mensagens').add({
      texto: cleanText,
      autor_firebase_uid: authorFirebaseUid,
      autor_uid: authorUid,
      autor_nome: Security.sanitize(authorName),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await conversaRef.update({
      lastMessage: cleanText,
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  // ============================================================
  //  MEUS REPORTES (localStorage)
  // ============================================================

  function saveMyReport(id, type) {
    const reports = getMyReports();
    if (!reports.find(r => r.id === id)) {
      reports.push({ id, type, date: Date.now() });
      localStorage.setItem('encontrePet_myReports', JSON.stringify(reports));
    }
  }

  function getMyReports() {
    try {
      const saved = localStorage.getItem('encontrePet_myReports');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  }

  async function loadMyReports() {
    const uid = Auth.getUID();
    if (!uid) return [];

    let results = [];

    if (useFirestore) {
      try {
        const petsResult = await fsList(TABLES.PETS, {
          where: [['owner_uid', '==', uid]],
          limit: 100
        });
        const pets = (petsResult.data || []).map(d => ({
          ...d,
          _reportType: 'pet_perdido',
          _reportDate: d.created_at?.toMillis ? d.created_at.toMillis() : new Date(d.created_at || 0).getTime()
        }));

        const avistResult = await fsList(TABLES.AVISTAMENTOS, {
          where: [['owner_uid', '==', uid]],
          limit: 100
        });
        const avist = (avistResult.data || []).map(d => ({
          ...d,
          _reportType: 'avistamento',
          _reportDate: d.created_at?.toMillis ? d.created_at.toMillis() : new Date(d.created_at || d.data_avistamento || 0).getTime()
        }));

        results = [...pets, ...avist];
        results.forEach(r => saveMyReport(r.id, r._reportType));

      } catch (err) {
        console.warn('[DB] loadMyReports Firestore falhou, usando localStorage:', err.message);
        results = await loadMyReportsFromLocalStorage();
      }
    } else {
      results = await loadMyReportsFromLocalStorage();
    }

    return results.sort((a, b) => b._reportDate - a._reportDate);
  }

  async function loadMyReportsFromLocalStorage() {
    const reports = getMyReports();
    if (reports.length === 0) return [];

    // Agrupar por tabela para batch em vez de N+1 queries individuais
    const petIds = reports.filter(r => r.type === 'pet_perdido').map(r => r.id);
    const avistIds = reports.filter(r => r.type !== 'pet_perdido').map(r => r.id);
    const dataMap = new Map();

    // Buscar pets em batch (usa list com cache em vez de get individual)
    if (petIds.length > 0) {
      try {
        const petsResult = await list(TABLES.PETS, { limit: 200 });
        (petsResult.data || []).forEach(d => {
          if (petIds.includes(d.id)) dataMap.set(d.id, d);
        });
      } catch (err) {
        console.warn('[DB] Batch pets falhou, fallback individual:', err.message);
        for (const id of petIds) {
          try { dataMap.set(id, await get(TABLES.PETS, id)); } catch {}
        }
      }
    }
    if (avistIds.length > 0) {
      try {
        const avistResult = await list(TABLES.AVISTAMENTOS, { limit: 200 });
        (avistResult.data || []).forEach(d => {
          if (avistIds.includes(d.id)) dataMap.set(d.id, d);
        });
      } catch (err) {
        console.warn('[DB] Batch avistamentos falhou, fallback individual:', err.message);
        for (const id of avistIds) {
          try { dataMap.set(id, await get(TABLES.AVISTAMENTOS, id)); } catch {}
        }
      }
    }

    return reports
      .filter(r => dataMap.has(r.id))
      .map(r => ({ ...dataMap.get(r.id), _reportType: r.type, _reportDate: r.date }));
  }

  // ============================================================
  //  ESTATÍSTICAS
  // ============================================================

  /**
   * Conta usuários ativos dentro de um raio a partir de um ponto.
   * Filtra: notificações ativadas + atividade nos últimos 30 dias.
   * @param {number} centerLat
   * @param {number} centerLng
   * @param {number} radiusKm
   * @returns {Promise<number>}
   */
  async function countUsersInRadius(centerLat, centerLng, radiusKm = 3) {
    if (!centerLat || !centerLng) return 0;

    // A Home chama isto a cada abertura: cache de 1h por região (~1 km) evita
    // invocar o backend repetidamente (cota Netlify/Firestore — custo zero).
    const cacheKey = `ep_reach_${centerLat.toFixed(2)}_${centerLng.toFixed(2)}_${radiusKm}`;
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
      if (cached && Date.now() - cached.t < 60 * 60 * 1000) return cached.count;
    } catch { /* storage indisponível: segue sem cache */ }

    // Só o backend (Admin SDK) conta: a N-01 fechou a listagem de usuarios no
    // cliente, então o antigo fallback local sempre falhava por permissão.
    try {
      const functions = FirebaseConfig.getFunctions?.();
      if (!functions?.httpsCallable) return 0;
      const res = await functions.httpsCallable('countUsersInRadius')({
        lat: centerLat, lng: centerLng, radiusKm
      });
      const count = typeof res?.data?.count === 'number' ? res.data.count : 0;
      try { sessionStorage.setItem(cacheKey, JSON.stringify({ count, t: Date.now() })); } catch {}
      return count;
    } catch (err) {
      console.warn('[DB] countUsersInRadius backend indisponível:', err.message);
      return 0;
    }
  }

  async function getStats() {
    try {
      const petsResult = await list(TABLES.PETS, { limit: 500 });
      const avistResult = await list(TABLES.AVISTAMENTOS, { limit: 500 });
      const allPets = petsResult.data || [];
      const encerrados = allPets.filter(p => p.status !== 'ativo');
      const encontradosVivos = allPets.filter(p => p.status === 'encontrado' || p.desfecho === 'encontrado_vivo');
      const totalPetsAtivos = allPets.filter(p => p.status === 'ativo').length;
      const totalEncontrados = encontradosVivos.length;

      // Taxa de sucesso (%) — pets encontrados vivos / total encerrados
      const totalEncerrados = encerrados.length;
      const taxaSucesso = totalEncerrados > 0 ? Math.round((totalEncontrados / totalEncerrados) * 100) : 0;

      // Pets com feedback positivo (app ajudou)
      const appAjudou = encerrados.filter(p => p.feedback_app_ajudou === true).length;

      return {
        totalPets: totalPetsAtivos,
        encontrados: totalEncontrados,
        avistamentos: (avistResult.data || []).length,
        taxaSucesso,
        appAjudou,
        historiasSucesso: encontradosVivos
          .filter(p => p.feedback_mensagem || p.feedback_app_ajudou)
          .sort((a, b) => {
            const tA = a.data_encerrado ? new Date(a.data_encerrado).getTime() : 0;
            const tB = b.data_encerrado ? new Date(b.data_encerrado).getTime() : 0;
            return tB - tA;
          })
          .slice(0, 10)
      };
    } catch (err) {
      console.error('[DB] Stats error:', err);
      return { totalPets: 0, encontrados: 0, avistamentos: 0, taxaSucesso: 0, appAjudou: 0, historiasSucesso: [] };
    }
  }

  // ============================================================
  //  CACHE
  // ============================================================

  function setCache(key, data) {
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, timestamp: Date.now() }));
    } catch (e) { /* localStorage full */ }
  }

  function getCache(key) {
    try {
      const cached = localStorage.getItem(CACHE_PREFIX + key);
      if (!cached) return null;
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp > CACHE_TTL) { localStorage.removeItem(CACHE_PREFIX + key); return null; }
      return data;
    } catch { return null; }
  }

  function clearCache(key) {
    if (key) {
      localStorage.removeItem(CACHE_PREFIX + key);
    } else {
      Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX)).forEach(k => localStorage.removeItem(k));
    }
  }

  function getStatus() {
    return {
      mode: useFirestore ? 'firestore' : (restAvailable ? 'rest' : 'cache'),
      firestore: useFirestore && FirebaseConfig.isReady(),
      restAvailable,
      projectId: useFirestore ? FirebaseConfig.getProjectInfo().projectId : 'N/A'
    };
  }

  /**
   * Escuta notificações do usuário em tempo real via Firestore onSnapshot.
   * Fallback: retorna função no-op quando Firestore não está disponível
   * (o polling de 60s em app.js cobre esse caso).
   * @param {string} uid - UID do usuário
   * @param {Function} onChange - callback(docs[])
   * @returns {Function} unsubscribe
   */
  function watchNotificacoes(uid, onChange) {
    if (!useFirestore || !uid) return () => {};
    try {
      const db = FirebaseConfig.getDB();
      const firebaseUid = FirebaseConfig.getFirebaseUID?.() || '';

      // Mapa compartilhado para deduplicar resultados das duas queries
      const merged = new Map();
      const notify = () => onChange([...merged.values()]);

      // Query 1: por destinatario_firebase_uid (Firebase Auth UID atual)
      let unsub1 = () => {};
      if (firebaseUid) {
        unsub1 = db.collection(TABLES.NOTIFICACOES)
          .where('destinatario_firebase_uid', '==', firebaseUid)
          .onSnapshot(
            snap => { snap.docs.forEach(d => merged.set(d.id, { id: d.id, ...d.data() })); notify(); },
            err => console.warn('[DB] watchNotificacoes (firebase_uid) error:', err.message)
          );
      }

      // Query 2: por destinatario_uid — só quando a rule pode permitir
      // (destinatario_uid == Firebase Auth UID). Com u_xxx/anon_xxx era sempre
      // negada: um listener a mais só para gerar erro.
      let unsub2 = () => {};
      if (uid === firebaseUid) {
        unsub2 = db.collection(TABLES.NOTIFICACOES)
          .where('destinatario_uid', '==', uid)
          .onSnapshot(
            snap => { snap.docs.forEach(d => merged.set(d.id, { id: d.id, ...d.data() })); notify(); },
            err => console.warn('[DB] watchNotificacoes (uid) error:', err.message)
          );
      }

      return () => { unsub1(); unsub2(); };
    } catch (err) {
      console.error('[DB] watchNotificacoes init error:', err);
      return () => {};
    }
  }

  /**
   * Escuta pets ativos em tempo real via Firestore onSnapshot.
   * @param {Function} onChange - callback(docs[])
   * @returns {Function} unsubscribe
   */
  /**
   * Cria documento de autorização imutável para que o avistador possa
   * ler os dados privados (alert_privado) do pet vinculado.
   * Documento ID: {sighterFirebaseUid}_{petId} — determinístico, sem duplicatas.
   * As Firestore Rules verificam a existência deste documento.
   * @param {string} petId - ID do pet perdido
   * @param {string} petOwnerFirebaseUid - Firebase UID do tutor
   * @param {string} sightingId - ID do avistamento que originou a autorização
   */
  async function createSighterAuthorization(petId, petOwnerFirebaseUid, sightingId) {
    if (!useFirestore || !petId) return;
    const sighterFirebaseUid = FirebaseConfig.getFirebaseUID?.() || '';
    if (!sighterFirebaseUid) return;
    const docId = `${sighterFirebaseUid}_${petId}`;
    try {
      const db = FirebaseConfig.getDB();
      // Tenta criar diretamente sem get() prévio — get() falha com permission-denied
      // quando o doc não existe (resource é null nas rules). Se o doc já existir,
      // o set() recebe permission-denied em "update" (update: false nas rules),
      // o que é aceitável: a autorização já está presente.
      await db.collection('sighter_authorizations').doc(docId).set({
        sighter_firebase_uid: sighterFirebaseUid,
        pet_id: petId,
        pet_owner_firebase_uid: petOwnerFirebaseUid || '',
        sighting_id: sightingId || '',
        created_at: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (err) {
      // permission-denied = doc já existe (update bloqueado pelas rules) → OK
      if (err.code !== 'permission-denied') {
        console.warn('[DB] createSighterAuthorization error:', err.message);
      }
    }
  }

  /**
   * Busca avistamentos vinculados a um pet perdido (para o tutor ver quem avistou).
   * Combina sightings linkados por pet_perdido_id e por matchedLostPetId (AI >=70%).
   * @param {string} petId - ID do pet perdido
   * @returns {Promise<Array>} Lista de avistamentos vinculados, ordenados por data desc
   */
  async function getLinkedSightings(petId) {
    if (!useFirestore || !petId) return [];
    try {
      const db = FirebaseConfig.getDB();
      // Query 1: vinculados manualmente (pet_perdido_id)
      const snap1 = await db.collection(TABLES.AVISTAMENTOS)
        .where('pet_perdido_id', '==', petId)
        .limit(20)
        .get();
      // Query 2: vinculados por AI match (matchedLostPetId)
      const snap2 = await db.collection(TABLES.AVISTAMENTOS)
        .where('matchedLostPetId', '==', petId)
        .limit(20)
        .get();
      // Merge sem duplicatas
      const seen = new Set();
      const results = [];
      for (const snap of [snap1, snap2]) {
        for (const doc of snap.docs) {
          if (!seen.has(doc.id)) {
            seen.add(doc.id);
            results.push({ id: doc.id, ...doc.data() });
          }
        }
      }
      // Ordenar por data desc
      results.sort((a, b) => {
        const tA = a.created_at?.toMillis?.() || new Date(a.data_avistamento || 0).getTime();
        const tB = b.created_at?.toMillis?.() || new Date(b.data_avistamento || 0).getTime();
        return tB - tA;
      });

      // [S-08 leitura] O doc público do avistamento não carrega mais
      // owner_firebase_uid (strip). A confirmação bilateral precisa desse UID
      // (contraparte da reunião). O backend (process-avistamento) grava
      // vinculos_avistamento/{avistamentoId} só com os UIDs — sem telefone nem
      // localização do avistador (o alert_privado continua só do dono). Só
      // busca quem estiver faltando e só roda no fluxo raro de fechamento.
      const faltandoUid = results.filter(r => !r.owner_firebase_uid);
      if (faltandoUid.length > 0) {
        await Promise.all(faltandoUid.map(async (sighting) => {
          try {
            const vinc = await db.collection('vinculos_avistamento').doc(sighting.id).get();
            if (vinc.exists) {
              const v = vinc.data() || {};
              if (v.sighter_firebase_uid) sighting.owner_firebase_uid = v.sighter_firebase_uid;
              if (!sighting.owner_uid && v.sighter_owner_uid) sighting.owner_uid = v.sighter_owner_uid;
            }
          } catch (e) {
            // Sem permissão / avistamento ainda não processado: contraparte não elegível.
          }
        }));
      }

      return results;
    } catch (err) {
      console.error('[DB] getLinkedSightings error:', err);
      return [];
    }
  }

  // ============================================================
  //  POLLING DO FEED (custo — substitui os onSnapshot de 200 docs)
  //  O feed não exige tempo real: um poll periódico via cache TTL
  //  compartilhado detecta novidades (som/contadores) sem manter dois
  //  listeners permanentes. Pausa com a aba oculta e revalida ao voltar.
  //  Realtime permanece apenas em notificações/chat/doc de detalhe.
  // ============================================================
  const FEED_POLL_MS = 5 * 60 * 1000;

  function pollFeed(fetcher, onChange) {
    let stopped = false;
    let timer = null;

    const schedule = () => {
      if (stopped) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.hidden) { schedule(); return; }
        tick(true);
      }, FEED_POLL_MS);
    };

    const tick = async (force) => {
      if (stopped) return;
      try {
        const result = await fetcher(force);
        if (!stopped) onChange(result.data || []);
      } catch (err) {
        console.warn('[DB] pollFeed error:', err.message);
      }
      schedule();
    };

    const onVisible = () => { if (!document.hidden && !stopped) tick(false); };
    document.addEventListener('visibilitychange', onVisible);

    tick(false);

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }

  function watchPetsAtivos(onChange) {
    return pollFeed(
      (force) => listarPetsAtivos({ force }),
      (docs) => onChange(docs.filter(p => p.status === 'ativo'))
    );
  }

  function watchAvistamentos(onChange) {
    return pollFeed((force) => listarAvistamentos({ force }), onChange);
  }

  // API pública
  return {
    init,
    TABLES,
    COLLECTIONS,
    create, get, list, update, remove,
    reportarPetPerdido,
    completarCadastro,
    marcarEncontrado,
    confirmarReuniao,
    reabrirReporte,
    countUsersInRadius,
    listarPetsAtivos,
    listarPetsPorProximidade,
    reportarAvistamento,
    listarAvistamentos,
    listRecentAlertsForSimilarity,
    watchAlertDocument,
    criarNotificacao,
    listarNotificacoes,
    marcarNotificacaoLida,
    getConversa,
    watchMensagensConversa,
    enviarMensagemConversa,
    savePrivateAlertData,
    getPrivateAlertData,
    getMyReports,
    loadMyReports,
    loadMyReportsFromLocalStorage,
    getStats,
    clearCache,
    getStatus,
    watchNotificacoes,
    watchPetsAtivos,
    watchAvistamentos,
    getLinkedSightings,
    getFullPhoto,
    createSighterAuthorization,
    processSyncQueue,
    patchPrivateAlertPhone
  };

})();
