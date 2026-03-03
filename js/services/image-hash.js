(function (global) {
  const HASH_SIZE = 16;

  function normalizeHash(hash) {
    return (hash || '').toString().trim().toLowerCase();
  }

  function bitsToHex(bits) {
    if (!bits || bits.length % 4 !== 0) return '';

    let output = '';
    for (let i = 0; i < bits.length; i += 4) {
      const nibble = parseInt(bits.slice(i, i + 4), 2);
      if (Number.isNaN(nibble)) return '';
      output += nibble.toString(16);
    }
    return output;
  }

  function generateHashFromImageElement(img, hashSize = HASH_SIZE) {
    if (!img || typeof document === 'undefined') {
      throw new Error('Ambiente sem suporte a canvas para hash de imagem');
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    canvas.width = hashSize + 1;
    canvas.height = hashSize;

    ctx.drawImage(img, 0, 0, hashSize + 1, hashSize);
    const pixels = ctx.getImageData(0, 0, hashSize + 1, hashSize).data;

    const gray = new Float32Array((hashSize + 1) * hashSize);
    for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
      gray[j] = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    }

    let bits = '';
    for (let y = 0; y < hashSize; y++) {
      for (let x = 0; x < hashSize; x++) {
        const left = gray[y * (hashSize + 1) + x];
        const right = gray[y * (hashSize + 1) + x + 1];
        bits += left < right ? '1' : '0';
      }
    }

    return bitsToHex(bits);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Falha ao carregar imagem para hash'));
      img.src = src;
    });
  }

  async function generateHashFromDataUrl(dataUrl) {
    if (!dataUrl) throw new Error('Imagem inválida para hash');

    if (typeof ImageUtils !== 'undefined' && typeof ImageUtils.generatePerceptualHash === 'function') {
      const img = await loadImage(dataUrl);
      return normalizeHash(ImageUtils.generatePerceptualHash(img));
    }

    const img = await loadImage(dataUrl);
    return normalizeHash(generateHashFromImageElement(img, HASH_SIZE));
  }

  async function ensureAlertImageHash(photoData) {
    try {
      const existingHash = normalizeHash(photoData?.imageHash || photoData?.hash || photoData?.foto_hash);
      if (existingHash) return existingHash;

      const dataUrl = photoData?.dataUrl || photoData?.foto_comprimida;
      if (!dataUrl) return '';

      return await generateHashFromDataUrl(dataUrl);
    } catch (error) {
      console.error('[ImageHash] Falha ao gerar hash:', error);
      return '';
    }
  }

  const api = {
    HASH_SIZE,
    normalizeHash,
    bitsToHex,
    generateHashFromImageElement,
    generateHashFromDataUrl,
    ensureAlertImageHash
  };

  global.ImageHashService = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
