/**
 * Encontre Pet - Firebase Configuration
 * Projeto: encontre-pet-137d2
 * 
 * Usa APENAS Firestore (banco de dados).
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
  let initialized = false;
  let isAvailable = false;

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

      // Habilitar persistência offline (API compatível com v10+)
      try {
        db.settings({ cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED, merge: true });
      } catch (e) { /* settings já aplicados */ }
      db.enablePersistence({ synchronizeTabs: true }).catch(err => {
        if (err.code === 'failed-precondition') {
          console.warn('[Firebase] Persistência offline: múltiplas abas');
        } else if (err.code === 'unimplemented') {
          console.warn('[Firebase] Navegador não suporta persistência offline');
        }
      });

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

  /**
   * Verifica se Firestore está disponível
   */
  function isReady() {
    return isAvailable && db !== null;
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
    isReady,
    getProjectInfo,
    CONFIG
  };

})();
