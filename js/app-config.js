/**
 * Encontre Pet - Configuracoes globais de produto
 * Fonte unica de verdade para limiares e raios por especie.
 */

(function initAppConfig(global) {
  const SEARCH_RADIUS_KM = Object.freeze({
    cao: 5,
    gato: 0.8,
    outro: 3
  });

  const config = Object.freeze({
    // Versão exibida no menu e em "Sobre". Manter igual ao CACHE_VERSION do sw.js.
    APP_VERSION: '1.21.2',
    MATCH_THRESHOLD: 70,
    HASH_MATCH_THRESHOLD: 70,
    // Foto cheia no Firebase Storage exige Blaze (sem bucket no Spark).
    // false = foto cheia em fotos/{colecao}_{id} no Firestore (custo zero).
    USE_FIREBASE_STORAGE: false,
    // Chave pública Web Push (Firebase Console → Configurações do projeto →
    // Cloud Messaging → Certificados push da Web). Vazia = push desligado.
    // Login com Google: ligar só depois de ativar o provedor Google no
    // Firebase Auth e cadastrar o redirect do proxy (docs/DEPLOY_NETLIFY.md).
    GOOGLE_LOGIN_ENABLED: false,
    PUSH_VAPID_KEY: 'BCneUR9AlD1nhkpr5vSrP2R5YTkTEQ2XkpFUdrHNtMo-E3kLYquL7Fb9vQDNpc_5c_4wGOdssTb5qsOtPITk9sw',
    SEARCH_RADIUS_KM,
    getSearchRadius(tipoAnimal) {
      return SEARCH_RADIUS_KM[tipoAnimal] || SEARCH_RADIUS_KM.outro;
    }
  });

  global.AppConfig = config;
})(window);
