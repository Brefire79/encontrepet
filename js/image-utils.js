/**
 * Encontre Pet - Image Utilities v2
 * Compressão ultra-rápida com progresso real em tempo real
 * Otimizado para urgência: foto → preview em < 1 segundo
 */

const ImageUtils = (() => {

  const CONFIG = {
    maxWidth: 800,
    maxHeight: 800,
    quality: 0.65,
    thumbnailSize: 200,
    hashSize: 16,
    maxFileSize: 120 * 1024 // 120KB máximo
  };

  /**
   * Comprime imagem com callback de progresso em tempo real
   * onProgress(percent, stepLabel) — chamado a cada etapa
   * Retorna: { dataUrl, thumbnail, hash, colors, originalSize, compressedSize }
   */
  async function compressImage(file, onProgress) {
    const report = onProgress || (() => {});
    const t0 = performance.now();

    // ── Etapa 1: Ler arquivo (10%) ──
    report(5, 'Lendo foto...');
    const dataUrl = await readFileAsDataURL(file);
    report(15, 'Foto carregada');

    // ── Etapa 2: Decodificar imagem (25%) ──
    report(20, 'Decodificando...');
    const img = await loadImage(dataUrl);
    report(30, `${img.width}×${img.height}px`);

    // ── Etapa 3: Comprimir (50%) ──
    report(35, 'Comprimindo...');
    await microYield();
    const compressed = resizeAndCompress(img, CONFIG.maxWidth, CONFIG.maxHeight, CONFIG.quality);
    report(55, 'Imagem comprimida');

    // ── Etapa 4: Thumbnail (65%) ──
    report(60, 'Gerando miniatura...');
    await microYield();
    const thumbnail = resizeAndCompress(img, CONFIG.thumbnailSize, CONFIG.thumbnailSize, 0.5);
    report(70, 'Miniatura pronta');

    // ── Etapa 5: Hash perceptual (80%) ──
    report(75, 'Gerando hash IA...');
    await microYield();
    const hash = generatePerceptualHash(img);
    report(85, 'Hash gerado');

    // ── Etapa 6: Cores dominantes (95%) ──
    report(88, 'Analisando cores...');
    await microYield();
    const colors = extractDominantColors(img);
    report(95, 'Cores extraídas');

    // ── Concluído ──
    const compressedSize = getBase64Size(compressed);
    const elapsed = Math.round(performance.now() - t0);
    report(100, `Pronto em ${elapsed}ms`);

    return {
      dataUrl: compressed,
      thumbnail,
      hash,
      colors,
      originalSize: file.size,
      compressedSize
    };
  }

  /**
   * Lê File como DataURL — usa createObjectURL quando possível (mais rápido)
   */
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * Carrega imagem a partir de DataURL
   */
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Erro ao carregar imagem'));
      img.src = src;
    });
  }

  /**
   * Cede o thread por 1 frame para a UI poder atualizar
   */
  function microYield() {
    return new Promise(resolve => requestAnimationFrame(resolve));
  }

  /**
   * Redimensiona e comprime usando Canvas — otimizado
   */
  function resizeAndCompress(img, maxW, maxH, quality) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    let { width, height } = img;

    if (width > maxW || height > maxH) {
      const ratio = Math.min(maxW / width, maxH / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    canvas.width = width;
    canvas.height = height;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium'; // 'medium' é mais rápido que 'high' e quase igual
    ctx.drawImage(img, 0, 0, width, height);

    let result = canvas.toDataURL('image/jpeg', quality);

    // Reduzir qualidade se necessário (máx 2 iterações para ser rápido)
    let currentQuality = quality;
    let attempts = 0;
    while (getBase64Size(result) > CONFIG.maxFileSize && currentQuality > 0.25 && attempts < 2) {
      currentQuality -= 0.15;
      result = canvas.toDataURL('image/jpeg', currentQuality);
      attempts++;
    }

    return result;
  }

  /**
   * Hash perceptual (dHash) para comparação de imagens
   */
  function generatePerceptualHash(img) {
    const size = CONFIG.hashSize;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    canvas.width = size + 1;
    canvas.height = size;
    ctx.drawImage(img, 0, 0, size + 1, size);

    const pixels = ctx.getImageData(0, 0, size + 1, size).data;

    // Escala de cinza
    const gray = new Float32Array((size + 1) * size);
    for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
      gray[j] = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    }

    // Hash diferencial → hexadecimal direto
    let hexHash = '';
    let nibble = 0;
    let bitCount = 0;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const left = gray[y * (size + 1) + x];
        const right = gray[y * (size + 1) + x + 1];
        nibble = (nibble << 1) | (left < right ? 1 : 0);
        bitCount++;
        if (bitCount === 4) {
          hexHash += nibble.toString(16);
          nibble = 0;
          bitCount = 0;
        }
      }
    }

    return hexHash;
  }

  /**
   * Distância de Hamming entre hashes → similaridade %
   */
  function compareHashes(hash1, hash2) {
    if (!hash1 || !hash2 || hash1.length !== hash2.length) return 0;

    const bin1 = hexToBinary(hash1);
    const bin2 = hexToBinary(hash2);

    let distance = 0;
    for (let i = 0; i < bin1.length; i++) {
      if (bin1[i] !== bin2[i]) distance++;
    }

    return Math.round(((bin1.length - distance) / bin1.length) * 10000) / 100;
  }

  function hexToBinary(hex) {
    let bin = '';
    for (let i = 0; i < hex.length; i++) {
      bin += parseInt(hex[i], 16).toString(2).padStart(4, '0');
    }
    return bin;
  }

  /**
   * Cores dominantes (rápido — usa canvas 30x30 em vez de 50x50)
   */
  function extractDominantColors(img) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    canvas.width = 30;
    canvas.height = 30;
    ctx.drawImage(img, 0, 0, 30, 30);

    const pixels = ctx.getImageData(0, 0, 30, 30).data;
    const buckets = {};

    for (let i = 0; i < pixels.length; i += 4) {
      const r = (pixels[i] >> 5) << 5;
      const g = (pixels[i + 1] >> 5) << 5;
      const b = (pixels[i + 2] >> 5) << 5;
      const key = `${r},${g},${b}`;
      buckets[key] = (buckets[key] || 0) + 1;
    }

    return Object.entries(buckets)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([c]) => {
        const [r, g, b] = c.split(',').map(Number);
        return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
      });
  }

  function getBase64Size(base64String) {
    const base64 = base64String.split(',')[1] || base64String;
    return Math.ceil(base64.length * 0.75);
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  return {
    compressImage,
    compareHashes,
    loadImage,
    formatFileSize,
    generatePerceptualHash,
    extractDominantColors,
    CONFIG
  };

})();
