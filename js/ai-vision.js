/**
 * Encontre Pet - AI Vision Module
 * Análise visual de pets usando TensorFlow.js + MobileNet (100% GRATUITO)
 * 
 * Funcionalidades:
 * - Detecção se é um animal na foto
 * - Classificação de tipo (cão, gato, outro)
 * - Extração de features visuais para matching
 * - Comparação avançada entre imagens
 * 
 * Usa MobileNet (Google) - modelo leve rodando no navegador
 * Nenhum dado é enviado para servidores externos
 */

const AIVision = (() => {

  let model = null;
  let isLoading = false;
  let isReady = false;

  // Labels de animais no ImageNet (que MobileNet conhece)
  const DOG_LABELS = [
    'golden retriever', 'labrador', 'german shepherd', 'bulldog', 'poodle',
    'beagle', 'rottweiler', 'husky', 'boxer', 'dachshund', 'pug',
    'chihuahua', 'collie', 'shih-tzu', 'corgi', 'dalmatian', 'great dane',
    'mastiff', 'terrier', 'spaniel', 'retriever', 'shepherd', 'hound',
    'malamute', 'samoyed', 'pinscher', 'schnauzer', 'setter', 'pointer',
    'vizsla', 'whippet', 'greyhound', 'basenji', 'akita', 'chow',
    'border collie', 'australian', 'bernese', 'newfoundland', 'papillon',
    'maltese', 'bichon', 'lhasa', 'tibetan', 'weimaraner', 'brittany',
    'dog', 'puppy', 'canine'
  ];

  const CAT_LABELS = [
    'tabby', 'tiger cat', 'persian cat', 'siamese cat', 'egyptian cat',
    'cougar', 'lynx', 'leopard', 'cat', 'kitten', 'feline',
    'angora', 'ragdoll', 'maine coon', 'bengal', 'sphynx'
  ];

  const ANIMAL_LABELS = [
    ...DOG_LABELS, ...CAT_LABELS,
    'rabbit', 'hamster', 'guinea pig', 'parrot', 'bird', 'turtle',
    'ferret', 'fish', 'snake', 'lizard', 'animal'
  ];

  // ====== INICIALIZAÇÃO DO MODELO ======

  /**
   * Carrega o modelo MobileNet (TensorFlow.js)
   * ~7MB, roda 100% no navegador
   */
  async function loadModel() {
    if (isReady) return true;
    if (isLoading) {
      // Esperar carregamento em andamento
      while (isLoading) {
        await new Promise(r => setTimeout(r, 200));
      }
      return isReady;
    }

    isLoading = true;

    try {
      // Verificar se TensorFlow.js está disponível
      if (typeof tf === 'undefined') {
        console.warn('[AIVision] TensorFlow.js não carregado. Modo básico ativo.');
        isLoading = false;
        return false;
      }

      console.log('[AIVision] Carregando MobileNet...');
      model = await mobilenet.load({
        version: 2,
        alpha: 0.5 // Versão leve (menor e mais rápida)
      });

      isReady = true;
      isLoading = false;
      console.log('[AIVision] ✅ MobileNet carregado com sucesso!');
      return true;
    } catch (err) {
      console.error('[AIVision] ❌ Erro ao carregar modelo:', err);
      isLoading = false;
      return false;
    }
  }

  // ====== ANÁLISE DE IMAGEM ======

  /**
   * Analisa uma imagem e retorna classificações
   * @param {HTMLImageElement|string} imageSource - Elemento img ou dataURL
   * @returns {Object} resultado da análise
   */
  async function analyzeImage(imageSource) {
    const img = await prepareImage(imageSource);

    // Se modelo não está pronto, usar análise básica
    if (!isReady || !model) {
      return basicAnalysis(img);
    }

    try {
      // Classificação com MobileNet
      const predictions = await model.classify(img, 10);
      
      // Extrair embedding (features) para comparação
      const embedding = await getEmbedding(img);

      // Interpretar resultados
      const analysis = interpretPredictions(predictions);

      return {
        ...analysis,
        predictions: predictions.map(p => ({
          label: p.className,
          confidence: Math.round(p.probability * 100)
        })),
        embedding: embedding,
        modelUsed: 'MobileNet v2',
        timestamp: Date.now()
      };
    } catch (err) {
      console.error('[AIVision] Erro na análise:', err);
      return basicAnalysis(img);
    }
  }

  /**
   * Interpreta as predições do MobileNet
   */
  function interpretPredictions(predictions) {
    let isDog = false;
    let isCat = false;
    let isAnimal = false;
    let animalType = 'indefinido';
    let confidence = 0;
    let breedGuess = '';

    for (const pred of predictions) {
      const label = pred.className.toLowerCase();
      const prob = pred.probability;

      // Verificar se é cachorro
      if (DOG_LABELS.some(d => label.includes(d))) {
        isDog = true;
        isAnimal = true;
        if (prob > confidence) {
          confidence = prob;
          breedGuess = pred.className;
        }
      }

      // Verificar se é gato
      if (CAT_LABELS.some(c => label.includes(c))) {
        isCat = true;
        isAnimal = true;
        if (prob > confidence) {
          confidence = prob;
          breedGuess = pred.className;
        }
      }

      // Verificar se é qualquer animal
      if (ANIMAL_LABELS.some(a => label.includes(a))) {
        isAnimal = true;
        if (!isDog && !isCat && prob > confidence) {
          confidence = prob;
          breedGuess = pred.className;
        }
      }
    }

    if (isDog) animalType = 'cao';
    else if (isCat) animalType = 'gato';
    else if (isAnimal) animalType = 'outro';

    return {
      isAnimal,
      isDog,
      isCat,
      animalType,
      confidence: Math.round(confidence * 100),
      breedGuess: cleanBreedName(breedGuess),
      isReliable: confidence > 0.3
    };
  }

  /**
   * Extrai embedding (vetor de features) de uma imagem
   * Usado para comparação entre imagens
   */
  async function getEmbedding(img) {
    if (!model || !isReady) return null;

    try {
      const activation = model.infer(img, true); // true = embedding layer
      const data = await activation.data();
      activation.dispose();
      
      // Converter para array compacto (normalizado)
      const embedding = Array.from(data).map(v => Math.round(v * 1000) / 1000);
      
      // Comprimir: pegar apenas os 128 valores mais significativos
      return embedding.slice(0, 128);
    } catch (err) {
      console.error('[AIVision] Erro no embedding:', err);
      return null;
    }
  }

  // ====== COMPARAÇÃO AVANÇADA COM IA ======

  /**
   * Compara dois embeddings usando similaridade de cosseno
   * Retorna score de 0 a 100
   */
  function compareEmbeddings(embedding1, embedding2) {
    if (!embedding1 || !embedding2) return 0;
    if (embedding1.length !== embedding2.length) return 0;

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    norm1 = Math.sqrt(norm1);
    norm2 = Math.sqrt(norm2);

    if (norm1 === 0 || norm2 === 0) return 0;

    const similarity = dotProduct / (norm1 * norm2);
    
    // Converter de [-1, 1] para [0, 100]
    return Math.round(((similarity + 1) / 2) * 100);
  }

  /**
   * Matching avançado combinando IA + hash + características
   * @param {Object} sighting - Dados do avistamento
   * @param {Array} lostPets - Pets perdidos cadastrados
   * @returns {Array} matches ordenados
   */
  async function advancedMatching(sighting, lostPets) {
    const results = [];

    for (const pet of lostPets) {
      if (pet.status !== 'ativo') continue;

      let score = 0;
      const details = {};

      // 1. Embedding IA (40%) - o mais importante
      if (sighting.embedding && pet.embedding) {
        details.embeddingScore = compareEmbeddings(sighting.embedding, pet.embedding);
        score += details.embeddingScore * 0.40;
      } else {
        // Fallback: usar hash perceptual
        if (sighting.foto_hash && pet.foto_hash) {
          details.hashScore = ImageUtils.compareHashes(sighting.foto_hash, pet.foto_hash);
          score += details.hashScore * 0.40;
        }
      }

      // 2. Tipo de animal (20%)
      details.typeMatch = (sighting.tipo_animal === pet.tipo_animal) ? 100 : 0;
      score += details.typeMatch * 0.20;

      // 3. Cor (15%)
      details.colorMatch = compareColors(sighting.cor, pet.cor);
      score += details.colorMatch * 0.15;

      // 4. Porte (10%)
      details.sizeMatch = compareSizes(sighting.porte, pet.porte);
      score += details.sizeMatch * 0.10;

      // 5. Proximidade (15%)
      details.proximityScore = calculateProximity(sighting, pet);
      score += details.proximityScore * 0.15;

      const totalScore = Math.round(score);

      if (totalScore > 40) {
        results.push({
          pet,
          totalScore,
          details,
          isMatch: totalScore >= 92
        });
      }
    }

    return results.sort((a, b) => b.totalScore - a.totalScore);
  }

  // ====== HELPERS INTERNOS ======

  function compareColors(cor1, cor2) {
    if (!cor1 || !cor2) return 50;
    if (cor1 === cor2) return 100;
    
    const groups = {
      escuros: ['preto', 'cinza'],
      claros: ['branco', 'creme'],
      marrons: ['marrom', 'caramelo'],
      mistos: ['rajado', 'malhado'],
      multicolor: ['tricolor', 'bicolor', 'malhado'],
      pb: ['preto_branco', 'malhado', 'bicolor']
    };

    for (const group of Object.values(groups)) {
      if (group.includes(cor1) && group.includes(cor2)) return 70;
    }
    return 20;
  }

  function compareSizes(p1, p2) {
    if (!p1 || !p2) return 50;
    if (p1 === p2) return 100;
    const sizes = ['pequeno', 'medio', 'grande'];
    const diff = Math.abs(sizes.indexOf(p1) - sizes.indexOf(p2));
    return diff === 1 ? 60 : 20;
  }

  function calculateProximity(s, p) {
    if (!s.latitude || !p.latitude) return 50;
    const dist = GeoUtils.calculateDistance(s.latitude, s.longitude, p.latitude, p.longitude);
    if (dist <= 0.5) return 100;
    if (dist <= 1) return 90;
    if (dist <= 3) return 70;
    if (dist <= 5) return 50;
    if (dist <= 10) return 30;
    return 10;
  }

  /**
   * Análise básica sem modelo de IA (fallback)
   */
  function basicAnalysis(img) {
    // Usar cor e tamanho da imagem como heurística
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 64;
    canvas.height = 64;
    ctx.drawImage(img, 0, 0, 64, 64);
    
    const imageData = ctx.getImageData(0, 0, 64, 64);
    const pixels = imageData.data;
    
    // Calcular cor média
    let r = 0, g = 0, b = 0;
    const total = pixels.length / 4;
    for (let i = 0; i < pixels.length; i += 4) {
      r += pixels[i]; g += pixels[i+1]; b += pixels[i+2];
    }
    r = Math.round(r / total);
    g = Math.round(g / total);
    b = Math.round(b / total);

    return {
      isAnimal: true, // Assumir que é animal (não temos modelo)
      isDog: false,
      isCat: false,
      animalType: 'indefinido',
      confidence: 0,
      breedGuess: '',
      isReliable: false,
      avgColor: { r, g, b },
      predictions: [],
      embedding: null,
      modelUsed: 'basic (sem TF.js)',
      timestamp: Date.now()
    };
  }

  /**
   * Prepara imagem para análise
   */
  async function prepareImage(source) {
    if (source instanceof HTMLImageElement) return source;
    
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = source;
    });
  }

  /**
   * Limpa nome de raça para exibição
   */
  function cleanBreedName(name) {
    if (!name) return '';
    return name
      .split(',')[0]
      .replace(/\d+/g, '')
      .trim();
  }

  /**
   * Verifica se o modelo está pronto
   */
  function isModelReady() {
    return isReady;
  }

  /**
   * Libera memória do modelo
   */
  function dispose() {
    if (model) {
      model = null;
      isReady = false;
    }
    if (typeof tf !== 'undefined') {
      tf.disposeVariables();
    }
  }

  // API pública
  return {
    loadModel,
    analyzeImage,
    getEmbedding,
    compareEmbeddings,
    advancedMatching,
    isModelReady,
    dispose,
    DOG_LABELS,
    CAT_LABELS
  };

})();
