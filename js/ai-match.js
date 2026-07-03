/**
 * Encontre Pet - AI Matching Engine v2
 * Gates → Pesos dinâmicos → Score → Timeout → Cancelamento
 * Nunca bloqueia UI. Fallback hash se IA falhar/timeout.
 */

const AIMatch = (() => {

  // ─── Configuração ───
  // Limiar de match padrao do produto (recall > precisao): 70%.
  const MATCH_THRESHOLD =
    (window.AppConfig && typeof window.AppConfig.MATCH_THRESHOLD === 'number')
      ? window.AppConfig.MATCH_THRESHOLD
      : 70;
  const HASH_MATCH_THRESHOLD =
    (window.AppConfig && typeof window.AppConfig.HASH_MATCH_THRESHOLD === 'number')
      ? window.AppConfig.HASH_MATCH_THRESHOLD
      : MATCH_THRESHOLD;
  const GATE_MAX_DISTANCE_KM = 50;          // G2: descarta se > 50 km
  const GATE_HASH_REPOST_HAMMING = 5;       // G3: hamming <= 5 = imagem quase idêntica
  const GATE_HASH_REPOST_GEO_KM  = 20;     // G3: se dist geo > 20 km + hash ≈ → fraude
  const AI_TIMEOUT_MS = 4000;               // timeout de 4 s para TF.js

  // ─── Pesos dinâmicos por distância (engine = 'AI' | 'HASH') ───
  const WEIGHT_TABLE = {
    AI:   [
      { maxKm: 1,  w: { visual: 0.40, tipo: 0.20, cor: 0.15, porte: 0.10, geo: 0.15 } },
      { maxKm: 5,  w: { visual: 0.35, tipo: 0.20, cor: 0.15, porte: 0.10, geo: 0.20 } },
      { maxKm: 20, w: { visual: 0.25, tipo: 0.20, cor: 0.15, porte: 0.10, geo: 0.30 } },
      { maxKm: Infinity, w: { visual: 0.15, tipo: 0.20, cor: 0.15, porte: 0.10, geo: 0.40 } }
    ],
    HASH: [
      { maxKm: 1,  w: { visual: 0.45, tipo: 0.15, cor: 0.20, porte: 0.10, geo: 0.10 } },
      { maxKm: 5,  w: { visual: 0.40, tipo: 0.15, cor: 0.20, porte: 0.10, geo: 0.15 } },
      { maxKm: 20, w: { visual: 0.30, tipo: 0.15, cor: 0.20, porte: 0.10, geo: 0.25 } },
      { maxKm: Infinity, w: { visual: 0.20, tipo: 0.15, cor: 0.20, porte: 0.10, geo: 0.35 } }
    ]
  };

  // Controle de cancelamento
  let _runId = 0;

  // ─── Helpers ───
  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('TIMEOUT')), ms);
      promise.then(v => { clearTimeout(timer); resolve(v); })
             .catch(e => { clearTimeout(timer); reject(e); });
    });
  }

  function getWeights(distKm, engine) {
    const table = WEIGHT_TABLE[engine] || WEIGHT_TABLE.HASH;
    for (const row of table) {
      if (distKm <= row.maxKm) return row.w;
    }
    return table[table.length - 1].w;
  }

  function geoDistKm(a, b) {
    if (!a.latitude || !b.latitude) return Number.POSITIVE_INFINITY;
    return GeoUtils.calculateDistance(
      Number(a.latitude), Number(a.longitude),
      Number(b.latitude), Number(b.longitude)
    );
  }

  // ─── Gate G3: hash quase idêntico + longe = provável repost/fraude ───
  function isRepostFraud(sighting, pet, distKm) {
    if (!sighting.foto_hash || !pet.foto_hash) return false;
    if (distKm <= GATE_HASH_REPOST_GEO_KM) return false;
    const hamming = SimilarityService.hammingDistance(sighting.foto_hash, pet.foto_hash);
    return Number.isFinite(hamming) && hamming <= GATE_HASH_REPOST_HAMMING;
  }

  /**
   * Hard filters — retorna razão de descarte ou null se candidato ok
   */
  function shouldDiscardCandidate(sighting, pet) {
    // G1: tipo diferente
    if (sighting.tipo_animal && pet.tipo_animal && sighting.tipo_animal !== pet.tipo_animal) {
      return 'type_mismatch';
    }
    // Status
    if (pet.status !== 'ativo') return 'inactive';
    // Distância
    const distKm = geoDistKm(sighting, pet);
    // G2: > 50 km
    if (Number.isFinite(distKm) && distKm > GATE_MAX_DISTANCE_KM) return 'too_far';
    // G3: repost/fraude
    if (isRepostFraud(sighting, pet, distKm)) return 'repost_fraud';
    return null;
  }

  // ─── Sub-scores ───
  function compareColors(c1, c2) {
    if (!c1 || !c2) return 50;
    if (c1 === c2) return 100;
    const groups = {
      escuros: ['preto', 'cinza'], claros: ['branco', 'creme'],
      marrons: ['marrom', 'caramelo'], mistos: ['rajado', 'malhado'],
      multicolor: ['tricolor', 'bicolor', 'malhado'],
      pb: ['preto_branco', 'malhado', 'bicolor']
    };
    for (const g of Object.values(groups)) { if (g.includes(c1) && g.includes(c2)) return 70; }
    return 20;
  }

  function compareSizes(p1, p2) {
    if (!p1 || !p2) return 50;
    if (p1 === p2) return 100;
    const s = ['pequeno', 'medio', 'grande'];
    const d = Math.abs(s.indexOf(p1) - s.indexOf(p2));
    return d === 1 ? 60 : 20;
  }

  function proximityScore(distKm) {
    if (!Number.isFinite(distKm)) return 50;
    if (distKm <= 0.5) return 100;
    if (distKm <= 1)   return 90;
    if (distKm <= 3)   return 70;
    if (distKm <= 5)   return 50;
    if (distKm <= 10)  return 30;
    if (distKm <= 20)  return 15;
    return 5;
  }

  // ─── Score principal (com pesos dinâmicos) ───
  function calculateScore(sighting, pet, engine) {
    const distKm = geoDistKm(sighting, pet);
    const w = getWeights(Number.isFinite(distKm) ? distKm : 999, engine);
    const scores = {};

    // Visual
    if (engine === 'AI' && sighting.embedding && pet.embedding) {
      scores.visual = (typeof AIVision !== 'undefined')
        ? AIVision.compareEmbeddings(sighting.embedding, pet.embedding)
        : 0;
    } else if (sighting.foto_hash && pet.foto_hash) {
      scores.visual = ImageUtils.compareHashes(sighting.foto_hash, pet.foto_hash);
    } else {
      scores.visual = 0;
    }

    scores.tipo  = (sighting.tipo_animal === pet.tipo_animal) ? 100 : 0;
    scores.cor   = compareColors(sighting.cor, pet.cor);
    scores.porte = compareSizes(sighting.porte, pet.porte);
    scores.geo   = proximityScore(distKm);

    const total = Math.round(
      scores.visual * w.visual +
      scores.tipo   * w.tipo  +
      scores.cor    * w.cor   +
      scores.porte  * w.porte +
      scores.geo    * w.geo
    );

    return { ...scores, total, distKm, engine };
  }

  // ─── Pipeline com gates + pesos dinâmicos ───
  function findMatches(sighting, pets, engine) {
    if (!sighting || !pets || pets.length === 0) return [];
    const eng = engine || 'HASH';
    // Threshold varia por engine.
    const threshold = eng === 'AI' ? MATCH_THRESHOLD : HASH_MATCH_THRESHOLD;

    return pets
      .map(pet => {
        const gateReason = shouldDiscardCandidate(sighting, pet);
        if (gateReason) return null;
        const sc = calculateScore(sighting, pet, eng);
        return { pet, totalScore: sc.total, details: sc, isMatch: sc.total >= threshold };
      })
      .filter(r => r !== null && r.totalScore > 40)
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, 10);
  }

  // ─── analyzeAndMatch — hash engine (fallback, sem delay artificial) ───
  async function analyzeAndMatch(sightingData, lostPets) {
    const matches = findMatches(sightingData, lostPets, 'HASH');
    const highMatches = matches.filter(m => m.isMatch);
    const possibleMatches = matches.filter(m => !m.isMatch && m.totalScore >= 60);
    return {
      highMatches, possibleMatches,
      totalAnalyzed: lostPets.filter(p => p.status === 'ativo').length,
      hasStrongMatch: highMatches.length > 0,
      engine: 'HASH'
    };
  }

  /**
   * advancedMatchingWithTimeout
   * Tenta IA (AIVision) com timeout. Se falhar, cai no hash.
   * Respeita token de cancelamento.
   */
  async function advancedMatchingWithTimeout(sightingData, lostPets, cancelToken) {
    // Tentar engine IA com timeout
    if (sightingData.embedding && typeof AIVision !== 'undefined') {
      try {
        const aiPromise = Promise.resolve(findMatches(sightingData, lostPets, 'AI'));
        const results = await withTimeout(aiPromise, AI_TIMEOUT_MS);
        if (cancelToken && cancelToken.cancelled) return null;
        return { matches: results, engine: 'AI' };
      } catch (e) {
        console.warn('[AIMatch] IA timeout/erro, fallback hash:', e.message);
      }
    }
    // Fallback hash
    if (cancelToken && cancelToken.cancelled) return null;
    const results = findMatches(sightingData, lostPets, 'HASH');
    return { matches: results, engine: 'HASH' };
  }

  /**
   * Cria token de cancelamento incremental.
   * Se um novo run começar, o anterior é marcado cancelled.
   */
  function createCancelToken() {
    const id = ++_runId;
    return { id, get cancelled() { return id !== _runId; } };
  }

  // ─── Notificação ───
  function generateMatchNotification(match, sighting) {
    const pet = match.pet;
    const score = match.totalScore;
    // i18n: usa I18n.t quando disponível; fallback PT mantém comportamento antigo.
    const hasI18n = typeof window !== 'undefined' && window.I18n && typeof window.I18n.t === 'function';
    const petName = pet.nome_pet || (hasI18n ? window.I18n.t('match.your_pet') : 'seu pet');
    const mensagem = hasI18n
      ? (score >= MATCH_THRESHOLD
          ? window.I18n.t('match.notify_high', { score, name: petName })
          : window.I18n.t('match.notify_low', { score, name: petName }))
      : (score >= MATCH_THRESHOLD
          ? `🎉 Possível match encontrado! Um animal com ${score}% de similaridade com ${petName} foi avistado!`
          : `👀 Um animal parecido com ${petName} foi avistado (${score}% de similaridade).`);
    return {
      pet_perdido_id: pet.id,
      avistamento_id: sighting.id || '',
      tipo: 'match_ia',
      mensagem,
      similaridade: score,
      lida: false,
      // Campos obrigatórios para as regras do Firestore conseguirem entregar ao tutor
      owner_firebase_uid: pet.owner_firebase_uid || '',
      owner_uid: pet.owner_uid || '',
      destinatario_firebase_uid: pet.owner_firebase_uid || '',
      destinatario_uid: pet.owner_uid || '',
      data: new Date().toISOString()
    };
  }

  function formatScore(score, engine) {
    // Usa threshold correto por engine para exibir labels coerentes com isMatch
    const highThreshold = (engine === 'AI') ? MATCH_THRESHOLD : HASH_MATCH_THRESHOLD;
    if (score >= highThreshold) return { text: 'Match Forte!', class: 'high', emoji: '🎉' };
    if (score >= 60)            return { text: 'Provável',     class: 'medium', emoji: '👀' };
    if (score >= 45)            return { text: 'Possível',     class: 'low', emoji: '🤔' };
    return { text: 'Improvável', class: 'none', emoji: '❌' };
  }

  // API pública
  return {
    findMatches,
    calculateScore,
    analyzeAndMatch,
    advancedMatchingWithTimeout,
    createCancelToken,
    shouldDiscardCandidate,
    getWeights,
    generateMatchNotification,
    formatScore,
    MATCH_THRESHOLD,
    HASH_MATCH_THRESHOLD,
    GATE_MAX_DISTANCE_KM,
    AI_TIMEOUT_MS
  };

})();
