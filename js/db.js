/**
 * Encontre Pet - Database Layer v1.0.0
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
    USUARIOS: 'usuarios'
  };

  const COLLECTIONS = TABLES;

  const CACHE_PREFIX = 'encontrePet_cache_';
  const CACHE_TTL = 5 * 60 * 1000;

  let useFirestore = false;
  let restAvailable = true; // assume REST works until proven otherwise

  function init() {
    try {
      const fb = FirebaseConfig.init();
      useFirestore = fb.isAvailable;
    } catch (e) {
      console.warn('[DB] FirebaseConfig não disponível:', e.message);
      useFirestore = false;
    }
    console.log('[DB] Modo:', useFirestore ? '🔥 Firestore + REST fallback' : '📡 REST API');
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

  // ============================================================
  //  PETS PERDIDOS
  // ============================================================

  async function reportarPetPerdido(data) {
    Security.checkRateLimit('report_pet', 3, 300000);
    Security.validateReportData(data);

    const raio = GeoUtils.getSearchRadius(data.tipo_animal);
    const settings = Auth.getUserSettings();

    const pubLoc = Security.getPublicLocation(
      data.latitude, data.longitude, data.endereco, settings
    );

    const record = {
      tipo_animal: data.tipo_animal || 'cao',
      subtipo_animal: Security.sanitize(data.subtipo_animal || ''),
      nome_pet: Security.sanitize(data.nome_pet || ''),
      raca: Security.sanitize(data.raca || ''),
      cor: data.cor || '',
      porte: data.porte || '',
      sexo: data.sexo || '',
      foto_comprimida: data.foto_comprimida || '',
      foto_hash: data.foto_hash || '',
      embedding: data.embedding || null,
      latitude: data.latitude || 0,
      longitude: data.longitude || 0,
      endereco: Security.sanitize(data.endereco || ''),
      latitude_publica: pubLoc.latitude,
      longitude_publica: pubLoc.longitude,
      endereco_publico: pubLoc.endereco,
      localizacao_aproximada: pubLoc.isApproximate,
      descricao: Security.sanitize(data.descricao || ''),
      recompensa: Security.sanitize(data.recompensa || ''),
      tem_recompensa: data.tem_recompensa || false,
      contato_nome: Security.sanitize(data.contato_nome || ''),
      contato_telefone: Security.sanitizePhone(data.contato_telefone || ''),
      contato_email: Security.sanitizeEmail(data.contato_email || ''),
      status: 'ativo',
      cadastro_completo: data.cadastro_completo || false,
      raio_busca_km: raio,
      data_perda: data.data_perda || new Date().toISOString().split('T')[0],
      visualizacoes: 0,
      owner_uid: Auth.getUID()
    };

    const result = await create(TABLES.PETS, record);
    saveMyReport(result.id, 'pet_perdido');
    return result;
  }

  async function completarCadastro(petId, data) {
    return await update(TABLES.PETS, petId, {
      nome_pet: Security.sanitize(data.nome_pet),
      raca: Security.sanitize(data.raca),
      sexo: data.sexo,
      data_perda: data.data_perda,
      descricao: Security.sanitize(data.descricao),
      contato_nome: Security.sanitize(data.contato_nome),
      contato_email: Security.sanitizeEmail(data.contato_email),
      cadastro_completo: true
    });
  }

  async function marcarEncontrado(petId) {
    return await update(TABLES.PETS, petId, { status: 'encontrado' });
  }

  /**
   * Lista pets ativos — usa where('status') SEM orderBy no Firestore
   * para evitar necessidade de índice composto.
   * Ordenação feita em JS pelo fsList().
   */
  async function listarPetsAtivos(page = 1) {
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

    const record = {
      pet_perdido_id: data.pet_perdido_id || '',
      tipo_animal: data.tipo_animal || 'cao',
      subtipo_animal: Security.sanitize(data.subtipo_animal || ''),
      foto_comprimida: data.foto_comprimida || '',
      foto_hash: data.foto_hash || '',
      embedding: data.embedding || null,
      latitude: data.latitude || 0,
      longitude: data.longitude || 0,
      endereco: Security.sanitize(data.endereco || ''),
      descricao: Security.sanitize(data.descricao || ''),
      reportado_por: Security.sanitize(data.reportado_por || ''),
      contato: Security.sanitizePhone(data.contato || ''),
      match_percentual: data.match_percentual || 0,
      status: 'pendente',
      cor: data.cor || '',
      porte: data.porte || '',
      data_avistamento: new Date().toISOString(),
      owner_uid: Auth.getUID()
    };

    const result = await create(TABLES.AVISTAMENTOS, record);
    saveMyReport(result.id, 'avistamento');
    return result;
  }

  async function listarAvistamentos(page = 1) {
    return await list(TABLES.AVISTAMENTOS, { limit: 50 });
  }

  // ============================================================
  //  NOTIFICAÇÕES
  // ============================================================

  async function criarNotificacao(data) {
    return await create(TABLES.NOTIFICACOES, Security.sanitizeObject(data));
  }

  async function listarNotificacoes(page = 1) {
    return await list(TABLES.NOTIFICACOES, { limit: 50 });
  }

  async function marcarNotificacaoLida(notifId) {
    return await update(TABLES.NOTIFICACOES, notifId, { lida: true });
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
    const reports = getMyReports();
    const results = [];

    for (const report of reports) {
      try {
        const table = report.type === 'pet_perdido' ? TABLES.PETS : TABLES.AVISTAMENTOS;
        const data = await get(table, report.id);
        results.push({ ...data, _reportType: report.type, _reportDate: report.date });
      } catch (err) {
        console.warn('Report not found:', report.id);
      }
    }

    return results.sort((a, b) => b._reportDate - a._reportDate);
  }

  // ============================================================
  //  ESTATÍSTICAS
  // ============================================================

  async function getStats() {
    try {
      const petsResult = await list(TABLES.PETS, { limit: 500 });
      const avistResult = await list(TABLES.AVISTAMENTOS, { limit: 500 });
      const allPets = petsResult.data || [];

      return {
        totalPets: allPets.filter(p => p.status === 'ativo').length,
        encontrados: allPets.filter(p => p.status === 'encontrado').length,
        avistamentos: (avistResult.data || []).length
      };
    } catch (err) {
      console.error('[DB] Stats error:', err);
      return { totalPets: 0, encontrados: 0, avistamentos: 0 };
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

  // API pública
  return {
    init,
    TABLES,
    COLLECTIONS,
    create, get, list, update, remove,
    reportarPetPerdido,
    completarCadastro,
    marcarEncontrado,
    listarPetsAtivos,
    listarPetsPorProximidade,
    reportarAvistamento,
    listarAvistamentos,
    criarNotificacao,
    listarNotificacoes,
    marcarNotificacaoLida,
    getMyReports,
    loadMyReports,
    getStats,
    clearCache,
    getStatus
  };

})();
