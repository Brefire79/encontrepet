/**
 * Encontre Pet - AI Matching Engine
 * Compara imagens de pets usando hash perceptual + características
 * para identificar possíveis matches com 92%+ de similaridade
 */

const AIMatch = (() => {

  // Limiar mínimo de similaridade para notificar (92%)
  const MATCH_THRESHOLD = 92;
  
  // Pesos para cada critério de comparação
  const WEIGHTS = {
    imageHash: 0.45,    // 45% - Similaridade visual (hash perceptual)
    colorMatch: 0.20,   // 20% - Cores dominantes
    animalType: 0.15,   // 15% - Mesmo tipo de animal
    sizeMatch: 0.10,    // 10% - Mesmo porte
    proximity: 0.10     // 10% - Proximidade geográfica
  };

  /**
   * Compara um avistamento com todos os pets perdidos cadastrados
   * Retorna lista de matches ordenados por similaridade
   */
  function findMatches(sighting, lostPets) {
    if (!sighting || !lostPets || lostPets.length === 0) return [];

    const results = lostPets
      .filter(pet => pet.status === 'ativo')
      .map(pet => {
        const score = calculateMatchScore(sighting, pet);
        return {
          pet,
          totalScore: score.total,
          details: score,
          isMatch: score.total >= MATCH_THRESHOLD
        };
      })
      .filter(result => result.totalScore > 50) // Pelo menos 50% para aparecer
      .sort((a, b) => b.totalScore - a.totalScore);

    return results;
  }

  /**
   * Calcula score de matching entre avistamento e pet perdido
   * Retorna objeto com scores individuais e total
   */
  function calculateMatchScore(sighting, lostPet) {
    const scores = {};

    // 1. Similaridade de imagem (Hash Perceptual)
    if (sighting.foto_hash && lostPet.foto_hash) {
      scores.imageHash = ImageUtils.compareHashes(sighting.foto_hash, lostPet.foto_hash);
    } else {
      scores.imageHash = 0;
    }

    // 2. Match de cores
    scores.colorMatch = compareColors(sighting.cor, lostPet.cor);

    // 3. Tipo de animal
    scores.animalType = (sighting.tipo_animal === lostPet.tipo_animal) ? 100 : 0;

    // 4. Porte
    scores.sizeMatch = compareSizes(sighting.porte, lostPet.porte);

    // 5. Proximidade geográfica
    scores.proximity = calculateProximityScore(sighting, lostPet);

    // Calcular score total ponderado
    const total = 
      scores.imageHash * WEIGHTS.imageHash +
      scores.colorMatch * WEIGHTS.colorMatch +
      scores.animalType * WEIGHTS.animalType +
      scores.sizeMatch * WEIGHTS.sizeMatch +
      scores.proximity * WEIGHTS.proximity;

    return {
      ...scores,
      total: Math.round(total * 100) / 100
    };
  }

  /**
   * Compara cores de pets
   */
  function compareColors(cor1, cor2) {
    if (!cor1 || !cor2) return 50; // Neutro se não tem dados

    // Match exato
    if (cor1 === cor2) return 100;

    // Cores similares
    const colorGroups = {
      escuros: ['preto', 'cinza'],
      claros: ['branco', 'creme'],
      marrons: ['marrom', 'caramelo'],
      mistos: ['rajado', 'malhado'],
      multicolor: ['tricolor', 'bicolor', 'malhado'],
      preto_branco: ['preto_branco', 'malhado', 'bicolor']
    };

    for (const group of Object.values(colorGroups)) {
      if (group.includes(cor1) && group.includes(cor2)) return 70;
    }

    return 20; // Cores diferentes
  }

  /**
   * Compara portes
   */
  function compareSizes(porte1, porte2) {
    if (!porte1 || !porte2) return 50; // Neutro

    if (porte1 === porte2) return 100;

    // Portes adjacentes (pequeno-medio, medio-grande)
    const sizes = ['pequeno', 'medio', 'grande'];
    const diff = Math.abs(sizes.indexOf(porte1) - sizes.indexOf(porte2));
    
    if (diff === 1) return 60;
    return 20;
  }

  /**
   * Calcula score de proximidade geográfica
   */
  function calculateProximityScore(sighting, lostPet) {
    if (!sighting.latitude || !lostPet.latitude) return 50;

    const distance = GeoUtils.calculateDistance(
      sighting.latitude, sighting.longitude,
      lostPet.latitude, lostPet.longitude
    );

    const maxRadius = GeoUtils.getSearchRadius(lostPet.tipo_animal || 'outro');

    if (distance <= 0.5) return 100;       // Menos de 500m
    if (distance <= 1) return 90;          // Menos de 1km
    if (distance <= maxRadius) return 75;   // Dentro do raio
    if (distance <= maxRadius * 2) return 40; // Até o dobro do raio
    return 10; // Muito longe
  }

  /**
   * Executa matching em tempo real quando uma foto é enviada
   * Simula o processo de IA analisando a foto
   */
  async function analyzeAndMatch(sightingData, lostPets) {
    // Simular tempo de processamento da IA
    await delay(1500);

    const matches = findMatches(sightingData, lostPets);
    
    // Separar matches altos (92%+) e possíveis
    const highMatches = matches.filter(m => m.isMatch);
    const possibleMatches = matches.filter(m => !m.isMatch && m.totalScore >= 60);

    return {
      highMatches,
      possibleMatches,
      totalAnalyzed: lostPets.filter(p => p.status === 'ativo').length,
      hasStrongMatch: highMatches.length > 0
    };
  }

  /**
   * Gera notificação de match para o dono do pet
   */
  function generateMatchNotification(match, sighting) {
    const pet = match.pet;
    const score = match.totalScore;
    
    return {
      pet_perdido_id: pet.id,
      avistamento_id: sighting.id || '',
      tipo: 'match_ia',
      mensagem: score >= MATCH_THRESHOLD 
        ? `🎉 Possível match encontrado! Um animal com ${score}% de similaridade com ${pet.nome_pet || 'seu pet'} foi avistado!`
        : `👀 Um animal parecido com ${pet.nome_pet || 'seu pet'} foi avistado (${score}% de similaridade).`,
      similaridade: score,
      lida: false,
      destinatario: pet.contato_telefone || pet.contato_email
    };
  }

  /**
   * Analisa características visuais da foto (simulação)
   * Em produção, isso usaria um modelo de ML real
   */
  async function analyzeImage(imageData) {
    await delay(800);
    
    return {
      confidence: 95,
      detected: 'animal',
      analysis: 'Imagem analisada com sucesso'
    };
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Formata o score para exibição
   */
  function formatScore(score) {
    if (score >= 92) return { text: 'Match Forte!', class: 'high', emoji: '🎉' };
    if (score >= 75) return { text: 'Provável', class: 'medium', emoji: '👀' };
    if (score >= 60) return { text: 'Possível', class: 'low', emoji: '🤔' };
    return { text: 'Improvável', class: 'none', emoji: '❌' };
  }

  // API pública
  return {
    findMatches,
    calculateMatchScore,
    analyzeAndMatch,
    generateMatchNotification,
    analyzeImage,
    formatScore,
    MATCH_THRESHOLD,
    WEIGHTS
  };

})();
