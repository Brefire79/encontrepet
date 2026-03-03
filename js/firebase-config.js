/**
 * Encontre Pet - Firebase Configuration
 * Projeto: encontre-pet-137d2
 * 
 * Usa Firestore + Storage.
 * Auth é local (SHA-256 + sessão) — mais seguro.
 * Fallback para REST API se Firebase falhar.
 */

const FirebaseConfig = (() => {

  const CONFIG = {
    apiKey: "AIzaSyCQ-gN4GStfnS5h51z3nZ56vZMXdTt6150",
    authDomain: "encontre-pet-137d2.firebaseapp.com",
    projectId: "encontre-pet-137d2",
    storageBucket: "encontre-pet-137d2.firebasestorage.app",
    messagingSenderId: "349690177679",
    appId: "1:349690177679:web:d98ed73ea558d2564668fa"
  };

  let app = null;
  let db = null;
  let storage = null;
  let auth = null;
  let firebaseUID = '';
  let initialized = false;
  let isAvailable = false;
  let authInitPromise = null;

  async function ensureAnonymousAuth() {
    if (!auth || typeof auth.signInAnonymously !== 'function') return '';
    try {
      if (auth.currentUser?.uid) {
        firebaseUID = auth.currentUser.uid;
        return firebaseUID;
      }
      const result = await auth.signInAnonymously();
      firebaseUID = result?.user?.uid || '';
      if (firebaseUID) {
        console.log('[Firebase] ✅ Auth anônimo ativo:', firebaseUID);
      }
      return firebaseUID;
    } catch (err) {
      console.warn('[Firebase] Auth anônimo indisponível:', err?.message || err);
      return '';
    }
  }

  /**
   * Inicializa o Firebase e Firestore
   * @returns {{ db, isAvailable }}
   */
  function init() {
    if (initialized) return { db, isAvailable };

    try {
      // Verificar se SDK está carregado
      if (typeof firebase === 'undefined' || !firebase.initializeApp) {
        console.warn('[Firebase] SDK não carregado. Usando REST API.');
        initialized = true;
        isAvailable = false;
        return { db: null, isAvailable: false };
      }

      // Inicializar App
      if (!firebase.apps || firebase.apps.length === 0) {
        app = firebase.initializeApp(CONFIG);
      } else {
        app = firebase.apps[0];
      }

      // Inicializar Firestore
      db = firebase.firestore();

      // Inicializar Storage (opcional)
      if (firebase.storage) {
        storage = firebase.storage();
      }

      // Inicializar Auth anônimo (opcional, para regras de segurança)
      if (firebase.auth) {
        auth = firebase.auth();
        authInitPromise = ensureAnonymousAuth();
        auth.onAuthStateChanged?.((user) => {
          firebaseUID = user?.uid || '';
        });
      }

      // Habilitar persistência offline (API moderna)
      try {
        db.settings({
          cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED,
          cache: firebase.firestore.persistentLocalCache
            ? firebase.firestore.persistentLocalCache({ tabManager: firebase.firestore.persistentMultipleTabManager() })
            : undefined,
          merge: true
        });
      } catch (e) { /* settings já aplicados */ }
      // Fallback para SDKs compat que ainda precisam de enablePersistence
      if (!firebase.firestore.persistentLocalCache) {
        db.enablePersistence({ synchronizeTabs: true }).catch(err => {
          if (err.code === 'failed-precondition') {
            console.warn('[Firebase] Persistência offline: múltiplas abas');
          } else if (err.code === 'unimplemented') {
            console.warn('[Firebase] Navegador não suporta persistência offline');
          }
        });
      }

      initialized = true;
      isAvailable = true;
      console.log('[Firebase] ✅ Firestore inicializado — projeto:', CONFIG.projectId);
      return { db, isAvailable: true };

    } catch (err) {
      console.error('[Firebase] ❌ Erro:', err.message);
      initialized = true;
      isAvailable = false;
      return { db: null, isAvailable: false };
    }
  }

  /**
   * Retorna instância do Firestore (ou null)
   */
  function getDB() {
    if (!initialized) init();
    return db;
  }

  function getStorage() {
    if (!initialized) init();
    return storage;
  }

  function getFirebaseUID() {
    if (!initialized) init();
    return firebaseUID || auth?.currentUser?.uid || '';
  }

  async function waitForAuthUID(timeoutMs = 6000) {
    if (!initialized) init();
    if (getFirebaseUID()) return getFirebaseUID();

    const start = Date.now();
    if (authInitPromise) {
      try { await authInitPromise; } catch {}
      if (getFirebaseUID()) return getFirebaseUID();
    }

    while (Date.now() - start < timeoutMs) {
      if (getFirebaseUID()) return getFirebaseUID();
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return getFirebaseUID();
  }

  async function uploadAlertImage({ alertId, dataUrl, collection = '', ownerUid = '' }) {
    if (!alertId || !dataUrl) throw new Error('uploadAlertImage requer alertId e dataUrl');
    const s = getStorage();
    if (!s) throw new Error('Firebase Storage não inicializado');

    const firebaseUserId = await waitForAuthUID();
    const path = `alerts/${alertId}/original.jpg`;
    const ref = s.ref(path);
    const metadata = {
      contentType: 'image/jpeg',
      customMetadata: {
        alertId: String(alertId),
        collection: String(collection || ''),
        ownerUid: String(ownerUid || ''),
        ownerFirebaseUid: String(firebaseUserId || ''),
        imageHashGenerated: 'false'
      }
    };

    await ref.putString(dataUrl, 'data_url', metadata);
    const downloadURL = await ref.getDownloadURL();
    return { path, downloadURL };
  }

  /**
   * Verifica se Firestore está disponível
   */
  function isReady() {
    return isAvailable && db !== null;
  }

  function isStorageReady() {
    return isAvailable && storage !== null;
  }

  /**
   * Retorna informações do projeto
   */
  function getProjectInfo() {
    return {
      projectId: CONFIG.projectId,
      configured: isAvailable,
      initialized
    };
  }

  return {
    init,
    getDB,
    getStorage,
    isReady,
    isStorageReady,
    getFirebaseUID,
    waitForAuthUID,
    uploadAlertImage,
    getProjectInfo,
    CONFIG
  };

})();
