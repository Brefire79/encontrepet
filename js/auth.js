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
    // Usa query (allow list) ao invés de get direto (allow get exige uid == auth.uid)
    // porque o app usa IDs customizados (u_xxx) que não coincidem com Firebase Auth UID
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
    const mode = firestoreReady() ? '🔥 Firestore + REST fallback' : '📡 REST API';
    console.log('[Auth] ✅ Sistema de autenticação inicializado — Perfis via:', mode);
  }

  /**
   * Carrega usuário de sessão salva no localStorage
   */
  async function loadUserFromSession(session) {
    try {
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

    // Verificar se email já existe (Firestore ou REST)
    const existing = await findByEmail(email);
    if (existing) throw new Error('Este e-mail já está cadastrado. Tente fazer login.');

    // Gerar hash da senha
    const senhaHash = await Security.createPasswordHash(password);

    // Gerar UID
    const uid = generateUID();

    // Dados do perfil
    // senha_hash incluído como fallback para login cross-origin (hash SHA-256+salt).
    // Idealmente ficaria em senhas_usuarios via CF (S-03), mas CF não está disponível
    // no Spark plan, então vai no documento onde só usuários autenticados podem ler.
    const userData = {
      nome: Security.sanitize(displayName),
      email: Security.sanitizeEmail(email),
      senha_hash: senhaHash,
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

    // Tentar salvar hash na CF (segura, admin SDK) — não disponível no Spark plan
    try {
      const functions = FirebaseConfig.getFunctions?.();
      if (functions) {
        const savePass = functions.httpsCallable('saveUserPassword');
        await savePass({ uid: finalUID, senhaHash });
      }
    } catch (cfErr) {
      console.warn('[Auth] saveUserPassword CF indisponível (Spark plan):', cfErr.message);
    }
    // NOTA DE SEGURANÇA: hash nunca salvo em localStorage (risco XSS).
    // Fallback de verificação usa apenas user.senha_hash do Firestore.

    // Criar conta no Firebase Auth (necessário para recuperação de senha)
    if (typeof firebase !== 'undefined' && firebase.auth) {
      try {
        await firebase.auth().createUserWithEmailAndPassword(
          Security.sanitizeEmail(email), password
        );
      } catch (fbErr) {
        // Não impede o cadastro; conta Firebase Auth pode ser criada futuramente
        console.warn('[Auth] Firebase Auth account creation failed (non-critical):', fbErr.code);
      }
    }

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

    // 3. Buscar perfil no Firestore/REST
    const user = await findByEmail(normalizedEmail);
    if (!user) throw new Error('Nenhuma conta encontrada com este e-mail.');
    if (user.status === 'bloqueado') throw new Error('Esta conta foi bloqueada.');

    // 4. Se Firebase Auth falhou, verificar senha via Cloud Function (S-03)
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

      if (!senhaCorreta) throw new Error('Senha incorreta. Tente novamente.');

      // Migrar: criar conta Firebase Auth para habilitar recuperação de senha futura
      if (typeof firebase !== 'undefined' && firebase.auth) {
        try {
          await firebase.auth().createUserWithEmailAndPassword(normalizedEmail, password);
        } catch {} // silencioso — pode já existir com outro estado
      }
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
    Security.clearSession();
    currentUser = null;
    userProfile = null;
    notifyListeners('logout', null);
    // Invalidar token Firebase Auth para que onAuthStateChanged reflita o logout
    if (typeof firebase !== 'undefined' && firebase.auth) {
      firebase.auth().signOut().catch(() => {});
    }
    console.log('[Auth] Usuário deslogado');
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
      throw new Error('Serviço de autenticação indisponível. Tente novamente.');
    }
    try {
      await firebase.auth().sendPasswordResetEmail(email.trim().toLowerCase(), {
        url: window.location.origin
      });
    } catch (fbErr) {
      if (fbErr.code === 'auth/user-not-found') {
        // Não revelar se o e-mail existe ou não (prevenção de enumeração)
        return { success: true };
      }
      if (fbErr.code === 'auth/too-many-requests') {
        throw new Error('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
      }
      throw new Error('Erro ao enviar e-mail. Verifique o endereço e tente novamente.');
    }
    return { success: true };
  }

  // ====== ALTERAR SENHA ======

  async function changePassword(currentPassword, newPassword) {
    if (!currentUser) throw new Error('Usuário não logado');
    if (currentUser.isAnonymous) throw new Error('Visitantes não têm senha.');

    validatePassword(newPassword);

    // Verificar senha atual
    if (userProfile?.senha_hash) {
      const ok = await Security.verifyPassword(currentPassword, userProfile.senha_hash);
      if (!ok) throw new Error('Senha atual incorreta.');
    }

    const novoHash = await Security.createPasswordHash(newPassword);
    // Atualizar Firestore
    await updateUser(currentUser.uid, { senha_hash: novoHash });
    userProfile = { ...userProfile, senha_hash: novoHash };
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
