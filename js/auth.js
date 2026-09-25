/**
 * Encontre Pet - Authentication System v1.1.0
 * Login, Cadastro, Perfil - Auth LOCAL (SHA-256 + sessão)
 * Perfis salvos em: Firestore (principal) + REST API (fallback)
 * 
 * ✅ Sem Firebase Auth - mais seguro e independente
 * ✅ Senhas hasheadas com SHA-256 + salt
 * ✅ Sessão com token de 64 caracteres (30 dias)
 * ✅ Rate limiting: 5 tentativas/minuto
 */

const Auth = (() => {

  let currentUser = null;
  let userProfile = null;
  let authListeners = [];

  const TABLE = 'usuarios';
  const COLLECTION = 'usuarios';

  // ====== HELPERS FIRESTORE ======

  /**
   * Verifica se Firestore está disponível para operações de usuário
   */
  function firestoreReady() {
    return typeof FirebaseConfig !== 'undefined' && FirebaseConfig.isReady();
  }

  /**
   * Gera um ID único para novos usuários
   */
  function generateUID() {
    return 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Salva perfil no Firestore com ID específico
   */
  async function fsCreateUser(uid, data) {
    const db = FirebaseConfig.getDB();
    const saveData = { ...data, created_at: firebase.firestore.FieldValue.serverTimestamp(), updated_at: firebase.firestore.FieldValue.serverTimestamp() };
    await db.collection(COLLECTION).doc(uid).set(saveData);
    return { id: uid, ...data };
  }

  /**
   * Busca usuário no Firestore por ID
   */
  async function fsGetUser(uid) {
    const db = FirebaseConfig.getDB();
    // 1) get direto — permitido quando o doc tem o Firebase Auth UID atual
    //    vinculado (firebase_auth_uids: preenchido no cadastro e no login via CF)
    try {
      const doc = await db.collection(COLLECTION).doc(uid).get();
      if (doc.exists) return { id: doc.id, ...doc.data() };
    } catch (e) {
      // permission-denied → doc legado sem vínculo; tenta query abaixo
    }
    // 2) Query por documentId (compat legado — rules permitem list com limit<=1)
    const snapshot = await db.collection(COLLECTION)
      .where(firebase.firestore.FieldPath.documentId(), '==', uid)
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  /**
   * Busca usuário no Firestore por email
   */
  async function fsFindByEmail(email) {
    const db = FirebaseConfig.getDB();
    const snapshot = await db.collection(COLLECTION)
      .where('email', '==', email)
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  /**
   * Atualiza perfil no Firestore
   */
  async function fsUpdateUser(uid, data) {
    const db = FirebaseConfig.getDB();
    data.updated_at = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection(COLLECTION).doc(uid).update(data);
    return { id: uid, ...data };
  }

  // ====== HELPERS REST API (tolerante a falhas — Netlify não tem backend) ======

  const isLocalDevHost = (() => {
    try {
      const h = window?.location?.hostname || '';
      return h === 'localhost' || h === '127.0.0.1';
    } catch {
      return false;
    }
  })();
  let restAvailable = isLocalDevHost;

  async function apiCreateUser(data) {
    if (!restAvailable) return null;
    try {
      const response = await fetch(`tables/${TABLE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (response.status === 404) { restAvailable = false; return null; }
      if (!response.ok) return null;
      return await response.json();
    } catch { restAvailable = false; return null; }
  }

  async function apiGetUser(uid) {
    if (!restAvailable) return null;
    try {
      const response = await fetch(`tables/${TABLE}/${uid}`);
      if (response.status === 404) { restAvailable = false; return null; }
      if (!response.ok) return null;
      return await response.json();
    } catch { restAvailable = false; return null; }
  }

  async function apiFindByEmail(email) {
    if (!restAvailable) return null;
    try {
      const response = await fetch(`tables/${TABLE}?search=${encodeURIComponent(email)}&limit=10`);
      if (response.status === 404) { restAvailable = false; return null; }
      if (!response.ok) return null;
      const result = await response.json();
      return (result.data || []).find(u => u.email === email) || null;
    } catch { restAvailable = false; return null; }
  }

  async function apiUpdateUser(uid, data) {
    if (!restAvailable) return null;
    try {
      const response = await fetch(`tables/${TABLE}/${uid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (response.status === 404) { restAvailable = false; return null; }
      if (!response.ok) return null;
      return await response.json();
    } catch { restAvailable = false; return null; }
  }

  // ====== HELPERS CLOUD FUNCTIONS (N-01) ======
  // Login/cadastro/recuperação resolvem email via CF (Admin SDK) para não
  // depender de `allow list` aberto na coleção usuarios. Enquanto as CFs
  // não estiverem deployadas, os fluxos caem no caminho legado (findByEmail).

  async function cfCall(name, payload) {
    const functions = FirebaseConfig.getFunctions?.();
    if (!functions) {
      const err = new Error('Cloud Functions indisponível');
      err.code = 'unavailable';
      throw err;
    }
    const fn = functions.httpsCallable(name);
    const res = await fn(payload);
    return res.data;
  }

  function cfErrorCode(err) {
    return String(err?.code || '').replace('functions/', '');
  }

  // ====== OPERAÇÕES UNIFICADAS (Firestore → REST fallback) ======

  async function createUser(uid, data) {
    if (firestoreReady()) {
      try {
        const result = await fsCreateUser(uid, data);
        console.log('[Auth] ✅ Perfil salvo no Firestore');
        // Não espelhar em REST quando Firestore já concluiu (evita ruído 405 em produção)
        return result;
      } catch (err) {
        console.warn('[Auth] Firestore create falhou:', err.message);
      }
    }
    const restResult = await apiCreateUser(data);
    if (restResult) return restResult;
    // Nenhum backend disponível — retornar objeto local
    return { id: uid, ...data };
  }

  async function getUser(uid) {
    if (firestoreReady()) {
      try {
        const user = await fsGetUser(uid);
        if (user) return user;
      } catch (err) {
        console.warn('[Auth] Firestore get falhou, usando REST:', err.message);
      }
    }
    return await apiGetUser(uid);
  }

  async function findByEmail(email) {
    if (firestoreReady()) {
      try {
        const user = await fsFindByEmail(email);
        if (user) return user;
      } catch (err) {
        console.warn('[Auth] Firestore search falhou, usando REST:', err.message);
      }
    }
    return await apiFindByEmail(email);
  }

  async function updateUser(uid, data) {
    if (firestoreReady()) {
      try {
        await fsUpdateUser(uid, data);
        console.log('[Auth] ✅ Perfil atualizado no Firestore');
        // Não espelhar em REST quando Firestore já concluiu (evita ruído 405 em produção)
        return { id: uid, ...data };
      } catch (err) {
        console.warn('[Auth] Firestore update falhou:', err.message);
      }
    }
    const restResult = await apiUpdateUser(uid, data);
    if (restResult) return restResult;
    return { id: uid, ...data };
  }

  // ====== INICIALIZAÇÃO ======

  function init() {
    const session = Security.getSession();
    if (session && session.uid) {
      loadUserFromSession(session);
    }
    const mode = firestoreReady() ? '[Firestore + REST fallback]' : '[REST API]';
    console.log('[Auth] Sistema de autenticacao inicializado - Perfis via:', mode);
  }

  /**
   * Carrega usuario de sessao salva no localStorage.
   * [FIX C11] Aguarda waitForAuthUID antes de consultar Firestore para evitar
   * "Missing or insufficient permissions" em queries que rodam antes do
   * auth anonimo Firebase estar pronto.
   */
  async function loadUserFromSession(session) {
    try {
      // Aguarda auth anonimo Firebase ficar pronto antes da query (race condition)
      if (typeof FirebaseConfig !== 'undefined' && FirebaseConfig.waitForAuthUID) {
        try { await FirebaseConfig.waitForAuthUID(3000); } catch {}
      }
      const user = await getUser(session.uid);
      if (user && user.status !== 'bloqueado') {
        currentUser = {
          uid: user.id,
          email: user.email || '',
          displayName: user.nome || session.name || 'Visitante',
          isAnonymous: user.is_anonymous || false
        };
        userProfile = user;
        notifyListeners('login', getUserData());
        console.log('[Auth] ✅ Sessão restaurada:', currentUser.displayName);
        return;
      }
    } catch (err) {
      console.warn('[Auth] Erro ao restaurar sessão:', err);
    }
    // Fallback: usar dados da sessão local
    currentUser = {
      uid: session.uid,
      email: session.email || '',
      displayName: session.name || 'Visitante',
      isAnonymous: session.isAnonymous || false
    };
    userProfile = {
      id: session.uid,
      nome: session.name || 'Visitante',
      email: session.email || '',
      is_anonymous: session.isAnonymous || false,
      config_notificacoes: true,
      config_loc_aproximada: true,
      config_raio_ofuscacao: 500,
      config_perfil_publico: false
    };
    notifyListeners('login', getUserData());
  }

  // ====== CADASTRO ======

  async function registerWithEmail(email, password, displayName) {
    Security.checkRateLimit('register', 3, 300000); // 3 registros em 5 min
    validateEmail(email);
    validatePassword(password);
    validateName(displayName);

    // Verificar se email já existe — via CF (não exige listar usuarios; N-01)
    let existing = null;
    try {
      const check = await cfCall('checkEmailExists', { email: Security.sanitizeEmail(email) });
      existing = check?.exists === true ? { exists: true } : null;
    } catch (cfErr) {
      // CF indisponível (deploy pendente/offline) — fallback legado por listagem
      existing = await findByEmail(email);
    }
    if (existing) throw new Error('Este e-mail já está cadastrado. Tente fazer login.');

    // Gerar hash da senha
    const senhaHash = await Security.createPasswordHash(password);

    // Conta no Firebase Auth PRIMEIRO. Antes o perfil era criado antes e, se
    // a conta Auth falhasse, o e-mail ficava "livre" no Firebase: outra
    // pessoa podia criar a conta com ele e assumir o perfil. Agora sem conta
    // Auth não há perfil — e o perfil já nasce vinculado a ela.
    let contaAuthUid = '';
    if (typeof firebase !== 'undefined' && firebase.auth) {
      try {
        const cred = await firebase.auth().createUserWithEmailAndPassword(Security.sanitizeEmail(email), password);
        contaAuthUid = cred?.user?.uid || '';
      } catch (fbErr) {
        if (fbErr.code === 'auth/email-already-in-use') throw new Error(I18n.t('auth.email_in_use'));
        console.warn('[Auth] Firebase Auth account creation failed:', fbErr.code);
        throw new Error(I18n.t('auth.signup_unavailable'));
      }
    }

    // Gerar UID
    const uid = generateUID();

    // Dados do perfil
    // senha_hash NÃO vai no doc público usuarios (S-03): o hash vive em
    // senhas_usuarios via CF saveUserPassword. Só se a CF estiver indisponível
    // o hash é gravado no doc como fallback legado (ver abaixo).
    const userData = {
      nome: Security.sanitize(displayName),
      email: Security.sanitizeEmail(email),
      // Vínculo com o Firebase Auth UID atual — habilita get direto do próprio
      // doc nas rules (isBoundUser) sem depender de listagem (N-01)
      // UID da conta recém-criada (o cache do FirebaseConfig ainda pode
      // estar com o UID anônimo — o onAuthStateChanged é assíncrono)
      firebase_auth_uids: (() => {
        const fbUid = contaAuthUid || FirebaseConfig.getFirebaseUID?.() || '';
        return fbUid ? [fbUid] : [];
      })(),
      telefone: '',
      cidade: '',
      foto_perfil: '',
      is_anonymous: false,
      pets_reportados: 0,
      avistamentos_count: 0,
      config_notificacoes: true,
      config_loc_aproximada: true,
      config_raio_ofuscacao: 500,
      config_perfil_publico: false,
      status: 'ativo',
      ultimo_login: new Date().toISOString()
    };

    // Salvar perfil (Firestore → REST fallback)
    const created = await createUser(uid, userData);
    const finalUID = created.id || uid;

    // Salvar hash na CF (segura, admin SDK — coleção senhas_usuarios)
    let hashSalvoNaCF = false;
    try {
      const functions = FirebaseConfig.getFunctions?.();
      if (functions) {
        const savePass = functions.httpsCallable('saveUserPassword');
        await savePass({ uid: finalUID, senhaHash });
        hashSalvoNaCF = true;
      }
    } catch (cfErr) {
      console.warn('[Auth] saveUserPassword CF indisponível:', cfErr.message);
    }
    if (!hashSalvoNaCF) {
      // [E2E 2026-07-05, achado 2] O fallback que gravava senha_hash no doc
      // público `usuarios` foi REMOVIDO — regredia o S-03. Com o backend
      // Netlify no mesmo origin do site, "backend indisponível" ≈ offline;
      // nesse caso o login usa Firebase Auth (que também guarda a senha).
      console.warn('[Auth] saveUserPassword indisponível — hash NÃO gravado em usuarios (S-03).');
    }
    // NOTA DE SEGURANÇA: hash nunca salvo em localStorage (risco XSS).

    // Criar sessão
    const token = Security.generateSessionToken();
    Security.saveSession(finalUID, token, { nome: displayName, email, is_anonymous: false });

    currentUser = {
      uid: finalUID,
      email: email,
      displayName: displayName,
      isAnonymous: false
    };
    userProfile = { ...userData, id: finalUID };
    notifyListeners('login', getUserData());

    return { success: true, user: currentUser };
  }

  // ====== LOGIN COM GOOGLE ======
  // O Google entrega e-mail verificado: o login-user aceita o e-mail do token
  // (email_verified) sem senha. No primeiro acesso o perfil é criado já
  // vinculado à conta Google. Ligado por AppConfig.GOOGLE_LOGIN_ENABLED.

  function googleLoginEnabled() {
    return typeof AppConfig !== 'undefined' && AppConfig.GOOGLE_LOGIN_ENABLED === true &&
      typeof firebase !== 'undefined' && !!firebase.auth;
  }

  function googleProvider() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return provider;
  }

  async function loginWithGoogle() {
    if (!googleLoginEnabled()) throw new Error(I18n.t('auth.google_error'));
    let cred;
    try {
      cred = await firebase.auth().signInWithPopup(googleProvider());
    } catch (err) {
      // Popup bloqueado (comum em app instalado/celular): segue por redirect;
      // a volta é tratada em completeGoogleRedirect() no início do app.
      if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
        await firebase.auth().signInWithRedirect(googleProvider());
        return { redirecting: true };
      }
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        return { cancelled: true };
      }
      console.warn('[Auth] Google login falhou:', err.code);
      throw new Error(I18n.t('auth.google_error'));
    }
    return finishGoogleLogin(cred.user);
  }

  async function completeGoogleRedirect() {
    if (!googleLoginEnabled()) return null;
    try {
      const result = await firebase.auth().getRedirectResult();
      if (result?.user && result.additionalUserInfo?.providerId === 'google.com') {
        return await finishGoogleLogin(result.user);
      }
    } catch (err) {
      console.warn('[Auth] retorno do Google falhou:', err.code || err.message);
    }
    return null;
  }

  async function finishGoogleLogin(googleUser) {
    const email = Security.sanitizeEmail((googleUser?.email || '').toLowerCase());
    if (!email) throw new Error(I18n.t('auth.google_error'));

    let user = null;
    let existe = false;
    try {
      existe = (await cfCall('checkEmailExists', { email }))?.exists === true;
      if (existe) user = (await cfCall('loginUser', { email }))?.user || null;
    } catch (cfErr) {
      if (cfErrorCode(cfErr) === 'permission-denied') throw new Error('Esta conta foi bloqueada.');
      throw new Error(I18n.t('auth.google_error'));
    }
    if (existe && !user) throw new Error(I18n.t('auth.google_error'));

    if (!user) {
      // Primeiro acesso: perfil novo, já vinculado a esta conta Google
      const uid = generateUID();
      const userData = {
        nome: Security.sanitize(googleUser.displayName || email.split('@')[0]),
        email,
        firebase_auth_uids: [googleUser.uid],
        telefone: '',
        cidade: '',
        foto_perfil: '',
        is_anonymous: false,
        pets_reportados: 0,
        avistamentos_count: 0,
        config_notificacoes: true,
        config_loc_aproximada: true,
        config_raio_ofuscacao: 500,
        config_perfil_publico: false,
        status: 'ativo',
        login_provider: 'google',
        ultimo_login: new Date().toISOString()
      };
      const created = await createUser(uid, userData);
      user = { ...userData, id: created.id || uid };
    }

    // Criar sessão
    const token = Security.generateSessionToken();
    Security.saveSession(user.id, token, { nome: user.nome, email: user.email, is_anonymous: false });
    currentUser = {
      uid: user.id,
      email: user.email,
      displayName: user.nome || email.split('@')[0],
      isAnonymous: false
    };
    userProfile = user;
    notifyListeners('login', getUserData());
    return { success: true, user: currentUser };
  }

  // ====== LOGIN ======

  async function loginWithEmail(email, password) {
    Security.checkRateLimit('login', 5, 60000); // 5 tentativas por minuto
    validateEmail(email);
    if (!password) throw new Error('Senha é obrigatória.');

    const normalizedEmail = email.trim().toLowerCase();
    let fbAuthOk = false;

    // 1. Tentar Firebase Auth (necessário para recuperação de senha funcionar)
    // Firebase v10+ retorna auth/invalid-credential tanto para senha errada
    // quanto para usuário inexistente, por isso sempre caímos no fallback SHA-256.
    if (typeof firebase !== 'undefined' && firebase.auth) {
      try {
        await firebase.auth().signInWithEmailAndPassword(normalizedEmail, password);
        fbAuthOk = true;
      } catch (fbErr) {
        // Qualquer falha do Firebase Auth → fallback para SHA-256 local
        console.warn('[Auth] Firebase Auth login failed, using SHA-256 fallback:', fbErr.code);
      }
    }

    // 2. Garantir auth anônimo antes de consultar Firestore (evita race condition)
    if (typeof FirebaseConfig !== 'undefined' && FirebaseConfig.waitForAuthUID) {
      await FirebaseConfig.waitForAuthUID(3000);
    }

    // 3. Buscar + verificar via Cloud Function loginUser (N-01: não lista usuarios).
    // [FIX B2] Mensagem de erro generica em login fail evita enumeracao de emails.
    const GENERIC_LOGIN_ERROR = 'E-mail ou senha incorretos.';
    let user = null;
    let cfResolveu = false;
    try {
      const data = await cfCall('loginUser', { email: normalizedEmail, password });
      user = data?.user || null;
      cfResolveu = !!user;
    } catch (cfErr) {
      const code = cfErrorCode(cfErr);
      if (code === 'unauthenticated') throw new Error(GENERIC_LOGIN_ERROR);
      if (code === 'permission-denied') throw new Error('Esta conta foi bloqueada.');
      if (code === 'resource-exhausted') throw new Error('Muitas tentativas de login. Aguarde 1 minuto.');
      // not-found/unavailable/internal → CF ainda não deployada ou offline
      console.warn('[Auth] loginUser CF indisponível, usando fluxo legado:', cfErr.message);
    }

    if (!cfResolveu) {
      // Fluxo legado (pré-deploy das CFs): busca por listagem + verificação
      user = await findByEmail(normalizedEmail);
      if (!user) throw new Error(GENERIC_LOGIN_ERROR);
      if (user.status === 'bloqueado') throw new Error('Esta conta foi bloqueada.');

      // Se Firebase Auth falhou, verificar senha via Cloud Function (S-03).
      // A CF lê de senhas_usuarios — o hash nunca fica exposto no cliente
      if (!fbAuthOk) {
        let senhaCorreta = false;

        try {
          const functions = FirebaseConfig.getFunctions?.();
          if (functions) {
            const verifyPass = functions.httpsCallable('verifyUserPassword');
            const result = await verifyPass({ uid: user.id, password });
            senhaCorreta = result.data?.valid === true;
          }
        } catch (cfErr) {
          // Fallback: verificação via senha_hash no Firestore (não usa localStorage — risco XSS)
          const storedHash = user.senha_hash || '';
          if (storedHash) {
            senhaCorreta = await Security.verifyPassword(password, storedHash);
          }
          console.warn('[Auth] verifyUserPassword CF falhou, fallback Firestore:', cfErr.message);
        }

        // [FIX B2] Erro generico nao revela se eh email-nao-existe ou senha-errada.
        if (!senhaCorreta) throw new Error(GENERIC_LOGIN_ERROR);
      }
    }

    // Migrar: criar conta Firebase Auth para habilitar recuperação de senha futura
    if (!fbAuthOk && typeof firebase !== 'undefined' && firebase.auth) {
      try {
        await firebase.auth().createUserWithEmailAndPassword(normalizedEmail, password);
      } catch {} // silencioso — pode já existir com outro estado
    }

    // Atualizar último login
    try {
      await updateUser(user.id, { ultimo_login: new Date().toISOString() });
    } catch {}

    // Criar sessão
    const token = Security.generateSessionToken();
    Security.saveSession(user.id, token, { nome: user.nome, email: user.email, is_anonymous: false });

    currentUser = {
      uid: user.id,
      email: user.email,
      displayName: user.nome || normalizedEmail.split('@')[0],
      isAnonymous: false
    };
    userProfile = user;
    notifyListeners('login', getUserData());

    return { success: true, user: currentUser };
  }

  // ====== MODO ANÔNIMO ======

  async function loginAnonymous() {
    const uid = generateUID();
    const userData = {
      nome: 'Visitante',
      email: '',
      telefone: '',
      cidade: '',
      foto_perfil: '',
      is_anonymous: true,
      pets_reportados: 0,
      avistamentos_count: 0,
      config_notificacoes: false,
      config_loc_aproximada: true,
      config_raio_ofuscacao: 800,
      config_perfil_publico: false,
      status: 'ativo',
      ultimo_login: new Date().toISOString()
    };

    // Visitante não é salvo no banco — apenas sessão local (evita acúmulo de registros)
    const token = Security.generateSessionToken();
    Security.saveSession(uid, token, { nome: 'Visitante', email: '', is_anonymous: true });

    currentUser = {
      uid,
      email: '',
      displayName: 'Visitante',
      isAnonymous: true
    };
    userProfile = { ...userData, id: uid };
    notifyListeners('login', getUserData());

    return { success: true, user: currentUser };
  }

  // ====== LOGOUT ======

  function logout() {
    // [FIX C3] signOut() do Firebase Auth ANTES de limpar sessao e notificar listeners.
    // Isso evita que onSnapshot dispare com auth.currentUser ja nulo no meio do logout
    // (causava erros silenciosos firestore/permission-denied no console).
    if (typeof firebase !== 'undefined' && firebase.auth) {
      try { firebase.auth().signOut().catch(() => {}); } catch {}
    }
    Security.clearSession();
    currentUser = null;
    userProfile = null;
    notifyListeners('logout', null);
    console.log('[Auth] Usuario deslogado');
  }

  // ====== PERFIL ======

  // Campos protegidos — usuários comuns nunca podem alterar (espelho do Firestore)
  const PROTECTED_FIELDS = new Set(['role', 'status']);

  async function updateProfile(data) {
    if (!currentUser) throw new Error('Usuário não logado');

    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      // Impedir escalada de privilégio via role/status (Firestore também bloqueia)
      if (!isAdmin() && PROTECTED_FIELDS.has(key)) continue;
      if (typeof value === 'string') {
        sanitized[key] = Security.sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }

    // Atualizar (Firestore → REST fallback)
    const updated = await updateUser(currentUser.uid, sanitized);
    userProfile = { ...userProfile, ...sanitized, ...updated };

    // Atualizar nome no currentUser se mudou
    if (sanitized.nome) currentUser.displayName = sanitized.nome;

    // Atualizar sessão
    const session = Security.getSession();
    if (session) {
      Security.saveSession(currentUser.uid, session.token, {
        nome: currentUser.displayName,
        email: currentUser.email,
        is_anonymous: currentUser.isAnonymous
      });
    }

    notifyListeners('profile_updated', getUserData());
    return updated;
  }

  async function updateSecuritySettings(settings) {
    const mapped = {};
    if (settings.localizacao_aproximada !== undefined) mapped.config_loc_aproximada = settings.localizacao_aproximada;
    if (settings.raio_ofuscacao_m !== undefined) mapped.config_raio_ofuscacao = settings.raio_ofuscacao_m;
    if (settings.perfil_publico !== undefined) mapped.config_perfil_publico = settings.perfil_publico;
    if (settings.notificacoes !== undefined) mapped.config_notificacoes = settings.notificacoes;
    return await updateProfile(mapped);
  }

  // ====== RECUPERACAO DE SENHA ======

  /**
   * Envia e-mail de recuperação via Firebase Authentication (gratuito, sem Cloud Functions).
   * Funciona para usuários que já passaram pelo login ou cadastro pelo menos uma vez
   * após esta versão do app (conta Firebase Auth criada automaticamente).
   */
  async function sendPasswordReset(email) {
    validateEmail(email);
    if (typeof firebase === 'undefined' || !firebase.auth) {
      throw new Error('Servico de autenticacao indisponivel. Tente novamente.');
    }
    const normalizedEmail = email.trim().toLowerCase();
    try {
      await firebase.auth().sendPasswordResetEmail(normalizedEmail, {
        url: window.location.origin
      });
    } catch (fbErr) {
      // [FIX C4] auth/user-not-found pode acontecer para perfis antigos que ainda
      // nao tem conta Firebase Auth (so existem em Firestore com senha_hash).
      // Antes a funcao retornava success silencioso e o e-mail nunca chegava.
      // Agora: verificamos no Firestore se o usuario existe. Se existir mas sem
      // conta Firebase Auth, instruimos a fazer login uma vez (o login cria a
      // conta automaticamente) e tentar reset depois. Mantemos enumeracao zero
      // retornando a mesma mensagem para email inexistente.
      if (fbErr.code === 'auth/user-not-found') {
        try {
          // Existência via CF (N-01); fallback legado por listagem
          let existing = null;
          try {
            const check = await cfCall('checkEmailExists', { email: normalizedEmail });
            existing = check?.exists === true ? { exists: true } : null;
          } catch (cfErr) {
            existing = await findByEmail(normalizedEmail);
          }
          if (existing) {
            // Conta existe so no Firestore — orientar usuario a fazer login antes
            throw new Error(
              'Este e-mail nao esta habilitado para recuperacao automatica. ' +
              'Faca login uma vez com sua senha atual e tente novamente.'
            );
          }
        } catch (lookupErr) {
          // findByEmail falhou — fingir sucesso para nao vazar enumeracao
          if (lookupErr.message?.includes('habilitado')) throw lookupErr;
        }
        // Email realmente nao existe — retornar success generico
        return { success: true };
      }
      if (fbErr.code === 'auth/too-many-requests') {
        throw new Error('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
      }
      throw new Error('Erro ao enviar e-mail. Verifique o endereco e tente novamente.');
    }
    return { success: true };
  }

  // ====== ALTERAR SENHA ======

  async function changePassword(currentPassword, newPassword) {
    if (!currentUser) throw new Error('Usuário não logado');
    if (currentUser.isAnonymous) throw new Error('Visitantes não têm senha.');

    validatePassword(newPassword);

    // Verificar senha atual — CF (senhas_usuarios) primeiro; fallback hash local
    let currentOk = false;
    let verificado = false;
    try {
      const res = await cfCall('verifyUserPassword', { uid: currentUser.uid, password: currentPassword });
      currentOk = res?.valid === true;
      verificado = true;
    } catch (cfErr) {
      // 'unauthenticated' sem hash local = senha realmente errada.
      // Com hash local (conta legada sem doc em senhas_usuarios), verifica abaixo.
      if (cfErrorCode(cfErr) === 'unauthenticated' && !userProfile?.senha_hash) {
        verificado = true;
      }
    }
    if (!verificado && userProfile?.senha_hash) {
      currentOk = await Security.verifyPassword(currentPassword, userProfile.senha_hash);
      verificado = true;
    }
    if (verificado && !currentOk) throw new Error('Senha atual incorreta.');

    const novoHash = await Security.createPasswordHash(newPassword);
    // Salvar via CF (senhas_usuarios); fallback legado: doc usuarios
    let salvoNaCF = false;
    try {
      const functions = FirebaseConfig.getFunctions?.();
      if (functions) {
        await functions.httpsCallable('saveUserPassword')({ uid: currentUser.uid, senhaHash: novoHash });
        salvoNaCF = true;
      }
    } catch (cfErr) {
      console.warn('[Auth] saveUserPassword CF indisponível:', cfErr.message);
    }
    if (salvoNaCF) {
      // Limpar hash legado do doc público, se existir (S-03)
      if (userProfile?.senha_hash) {
        try { await updateUser(currentUser.uid, { senha_hash: '' }); } catch {}
      }
      userProfile = { ...userProfile };
      delete userProfile.senha_hash;
    } else {
      // Sem backend não há onde guardar o hash com segurança: gravar em
      // `usuarios` regrediria o S-03 (mesma correção do cadastro).
      throw new Error(I18n.t('toast.password_change_unavailable'));
    }
    // Sincronizar Firebase Auth (habilita recuperação de senha por e-mail)
    if (typeof firebase !== 'undefined' && firebase.auth?.()?.currentUser) {
      try {
        await firebase.auth().currentUser.updatePassword(newPassword);
        console.log('[Auth] ✅ Firebase Auth password atualizado.');
      } catch (fbErr) {
        console.warn('[Auth] Firebase Auth updatePassword falhou (re-autenticação pode ser necessária):', fbErr.code);
      }
    }
    return { success: true };
  }

  // ====== GETTERS ======

  function isLoggedIn() {
    return currentUser !== null;
  }

  function isAnonymous() {
    return currentUser?.isAnonymous || false;
  }

  function getUserData() {
    if (!currentUser) return null;
    const profile = userProfile ? { ...userProfile } : null;
    // Nunca expor senha_hash pela API pública — campo interno de verificação
    if (profile) delete profile.senha_hash;
    return {
      uid: currentUser.uid,
      email: currentUser.email || '',
      displayName: currentUser.displayName || 'Visitante',
      photoURL: profile?.foto_perfil || '',
      isAnonymous: isAnonymous(),
      profile
    };
  }

  function getUserSettings() {
    return {
      notificacoes: userProfile?.config_notificacoes !== false,
      localizacao_aproximada: userProfile?.config_loc_aproximada !== false,
      raio_ofuscacao_m: userProfile?.config_raio_ofuscacao || 500,
      perfil_publico: userProfile?.config_perfil_publico || false
    };
  }

  function getUID() {
    return currentUser?.uid || 'anon_' + Date.now();
  }

  /**
   * Verifica se o usuário logado é admin
   * Baseado no campo 'role' do perfil no Firestore
   */
  function isAdmin() {
    return userProfile?.role === 'admin';
  }

  /**
   * Retorna o perfil completo do usuário (incluindo role), sem dados sensíveis
   */
  function getProfile() {
    if (!userProfile) return null;
    const profile = { ...userProfile };
    delete profile.senha_hash; // nunca expor hash pela API pública
    return profile;
  }

  // ====== VALIDAÇÕES ======

  function validateEmail(email) {
    if (!email || typeof email !== 'string') throw new Error('E-mail é obrigatório.');
    // RFC 5321 simplificado: exige TLD com pelo menos 2 letras (rejeita "test@a.b")
    const regex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    if (!regex.test(email.trim())) throw new Error('E-mail inválido.');
  }

  function validatePassword(password) {
    if (!password || typeof password !== 'string') throw new Error('Senha é obrigatória.');
    if (password.length < 6) throw new Error('A senha deve ter pelo menos 6 caracteres.');
    if (password.length > 128) throw new Error('Senha muito longa.');
  }

  function validateName(name) {
    if (!name || typeof name !== 'string') throw new Error('Nome é obrigatório.');
    if (name.trim().length < 2) throw new Error('Nome deve ter pelo menos 2 caracteres.');
    if (name.length > 100) throw new Error('Nome muito longo.');
  }

  // ====== LISTENERS ======

  function onAuthChange(callback) {
    authListeners.push(callback);
    if (currentUser) {
      setTimeout(() => callback('login', getUserData()), 0);
    }
  }

  function notifyListeners(event, data) {
    authListeners.forEach(cb => {
      try { cb(event, data); } catch (e) { console.error(e); }
    });
  }

  // API pública
  return {
    init,
    registerWithEmail,
    loginWithEmail,
    loginWithGoogle,
    completeGoogleRedirect,
    googleLoginEnabled,
    loginAnonymous,
    logout,
    updateProfile,
    updateSecuritySettings,
    sendPasswordReset,
    changePassword,
    isLoggedIn,
    isAnonymous,
    isAdmin,
    getUserData,
    getUserSettings,
    getUID,
    getProfile,
    onAuthChange,
    validateEmail,
    validatePassword
  };

})();
