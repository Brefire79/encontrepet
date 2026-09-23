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
    MATCH_THRESHOLD: 70,
    HASH_MATCH_THRESHOLD: 70,
    // Foto cheia no Firebase Storage exige Blaze (sem bucket no Spark).
    // false = foto cheia em fotos/{colecao}_{id} no Firestore (custo zero).
    USE_FIREBASE_STORAGE: false,
    SEARCH_RADIUS_KM,
    getSearchRadius(tipoAnimal) {
      return SEARCH_RADIUS_KM[tipoAnimal] || SEARCH_RADIUS_KM.outro;
    }
  });

  global.AppConfig = config;
})(window);
