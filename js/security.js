/**
 * Encontre Pet - Security Module v1.1.0
 * Proteção de dados, hash de senhas (SHA-256), ofuscação de localização,
 * sanitização, rate limiting e controle de privacidade
 * 
 * ✅ Tudo roda 100% no navegador, sem dependência externa
 */

const Security = (() => {

  // ====== HASH DE SENHA (SHA-256 via Web Crypto API) ======

  /**
   * Gera um salt aleatório para hash de senha
   * @returns {string} Salt em hex (32 chars)
   */
  function generateSalt() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Hash de senha usando SHA-256 + salt (via Web Crypto API nativa)
   * @param {string} password - Senha em texto plano
   * @param {string} salt - Salt aleatório
   * @returns {Promise<string>} Hash em hex
   */
  async function hashPassword(password, salt) {
    const encoder = new TextEncoder();
    const data = encoder.encode(salt + password + salt);
    // Duplo hash para segurança extra
    const hash1 = await crypto.subtle.digest('SHA-256', data);
    const hash2 = await crypto.subtle.digest('SHA-256', hash1);
    return Array.from(new Uint8Array(hash2), b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Verifica se a senha corresponde ao hash armazenado
   * @param {string} password - Senha a verificar
   * @param {string} storedHash - Hash armazenado (formato: salt:hash)
   * @returns {Promise<boolean>}
   */
  async function verifyPassword(password, storedHash) {
    if (!storedHash || !storedHash.includes(':')) return false;
    const [salt, hash] = storedHash.split(':');
    const computed = await hashPassword(password, salt);
    return computed === hash;
  }

  /**
   * Cria hash de senha para armazenamento (salt:hash)
   * @param {string} password - Senha em texto plano
   * @returns {Promise<string>} Formato "salt:hash"
   */
  async function createPasswordHash(password) {
    const salt = generateSalt();
    const hash = await hashPassword(password, salt);
    return salt + ':' + hash;
  }

  // ====== SESSÃO & TOKEN ======

  // Expiração: 30 dias em ms (sessão persistente — usuário não precisa relogar toda vez)
  const SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
  const SESSION_KEY = 'encontrePet_session';

  /**
   * Gera um token de sessão aleatório
   * @returns {string} Token seguro (64 chars hex)
   */
  function generateSessionToken() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Salva sessão com expiração de 30 dias no localStorage.
   * localStorage mantém o login entre abas e reinicializações do browser —
   * essencial para um app de busca de pets usado sob estresse.
   */
  function saveSession(userId, token, userData) {
    const session = {
      uid: userId,
      token: token,
      name: userData.nome || 'Visitante',
      email: userData.email || '',
      isAnonymous: userData.is_anonymous || false,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_EXPIRY_MS
    };
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (e) {
      // Fallback para sessionStorage se localStorage estiver bloqueado (ex: Safari privado)
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
  }

  /**
   * Recupera sessão do localStorage e valida expiração (30 dias).
   * @returns {Object|null} Dados da sessão ou null se não existe/expirou
   */
  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
               || sessionStorage.getItem(SESSION_KEY); // fallback legacy/Safari privado
      if (!raw) return null;
      const session = JSON.parse(raw);
      // Sessões antigas (sem expiresAt): migrar adicionando prazo de 30 dias
      if (!session.expiresAt) {
        session.expiresAt = Date.now() + SESSION_EXPIRY_MS;
        try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
        return session;
      }
      // Sessão expirada — limpar e forçar novo login
      if (Date.now() > session.expiresAt) {
        clearSession();
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }

  /**
   * Limpa sessão (logout)
   */
  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY); // limpar fallback/legacy
  }

  // ====== SANITIZAÇÃO DE DADOS ======

  /**
   * Remove HTML, scripts e caracteres perigosos de texto
   * Preserva Data URLs de imagem (base64) sem corrompê-las
   */
  function sanitize(input) {
    if (input === null || input === undefined) return '';
    if (typeof input !== 'string') return String(input);
    
    // Preservar Data URLs de imagem — não sanitizar base64
    if (/^data:image\/[a-z+]+;base64,/i.test(input)) return input;

    // [FIX C7] Removido escape de '/' que destruia URLs (https://) e datas (01/01/2026).
    // A barra '/' isolada nao e vetor de XSS no contexto de texto; escapamos apenas
    // os caracteres realmente perigosos (<, >, &, ", ') e bloqueamos javascript:/on*=.
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .replace(/data:(?!image\/)/gi, 'blocked:')
      .trim();
  }

  /**
   * Campos que contêm Data URLs (base64) e NÃO devem ser sanitizados como texto
   */
  const DATA_URL_FIELDS = new Set(['foto_comprimida', 'dataUrl', 'foto']);

  /**
   * Verifica se uma string é uma Data URL de imagem válida
   */
  function isImageDataUrl(str) {
    return typeof str === 'string' && /^data:image\/[a-z+]+;base64,/i.test(str);
  }

  /**
   * Sanitiza um objeto inteiro recursivamente
   * Preserva campos de Data URL de imagem (base64) sem corrompê-los
   */
  function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    
    const cleaned = Array.isArray(obj) ? [] : {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        // Preservar Data URLs de imagem — não sanitizar base64
        if (DATA_URL_FIELDS.has(key) && isImageDataUrl(value)) {
          cleaned[key] = value;
        } else {
          cleaned[key] = sanitize(value);
        }
      } else if (typeof value === 'object' && value !== null) {
        cleaned[key] = sanitizeObject(value);
      } else {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }

  /**
   * Sanitiza telefone — aceita apenas números e formato
   */
  function sanitizePhone(phone) {
    if (!phone) return '';
    return phone.replace(/[^\d()\s\-+]/g, '').substring(0, 20);
  }

  /**
   * Normaliza telefone BR para apenas dígitos (sem formatação).
   * Remove +55 se existir. Resultado: 10 ou 11 dígitos (DDD + número).
   * Retorna string vazia se inválido.
   */
  function normalizePhoneBR(phone) {
    if (!phone) return '';
    let digits = phone.replace(/\D/g, '');
    // Remover prefixo do país (55)
    if (digits.length >= 12 && digits.startsWith('55')) {
      digits = digits.substring(2);
    }
    // Deve ter 10 (fixo) ou 11 (celular) dígitos
    if (digits.length < 10 || digits.length > 11) return '';
    // DDD válido: 11-99
    const ddd = parseInt(digits.substring(0, 2));
    if (ddd < 11 || ddd > 99) return '';
    return digits;
  }

  /**
   * Valida se é um telefone brasileiro válido.
   * Aceita: (11) 91234-5678, 11912345678, +55 11 91234-5678, etc.
   * @returns {{ valid: boolean, normalized: string, error: string }}
   */
  function validatePhoneBR(phone) {
    if (!phone || !phone.trim()) return { valid: true, normalized: '', error: '' }; // Opcional
    const normalized = normalizePhoneBR(phone);
    if (!normalized) {
      return { valid: false, normalized: '', error: 'phone_invalid' };
    }
    return { valid: true, normalized, error: '' };
  }

  /**
   * Sanitiza email
   */
  function sanitizeEmail(email) {
    if (!email) return '';
    return email.replace(/[^a-zA-Z0-9@.\-_+]/g, '').substring(0, 254);
  }

  // ====== OFUSCAÇÃO DE LOCALIZAÇÃO ======

  /**
   * Ofusca coordenadas GPS adicionando ruído aleatório
   * NÃO revela a localização exata do usuário
   * 
   * @param {number} lat - Latitude real
   * @param {number} lng - Longitude real
   * @param {number} radiusMeters - Raio de ofuscação em metros (padrão: 500m)
   * @returns {{ lat, lng, isApproximate }} Coordenadas ofuscadas
   */
  function obfuscateLocation(lat, lng, radiusMeters = 500) {
    if (!lat || !lng) return { lat: 0, lng: 0, isApproximate: true };

    // Converter raio de metros para graus (aproximação)
    const radiusDegLat = radiusMeters / 111320;
    const radiusDegLng = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180));

    // Gerar ponto aleatório dentro do raio (distribuição uniforme no círculo)
    const angle = Math.random() * 2 * Math.PI;
    const distance = Math.sqrt(Math.random());

    const offsetLat = distance * radiusDegLat * Math.cos(angle);
    const offsetLng = distance * radiusDegLng * Math.sin(angle);

    return {
      lat: Math.round((lat + offsetLat) * 10000) / 10000,
      lng: Math.round((lng + offsetLng) * 10000) / 10000,
      isApproximate: true
    };
  }

  /**
   * Retorna localização para exibição pública conforme config do usuário
   */
  function getPublicLocation(lat, lng, endereco, userSettings) {
    const settings = userSettings || { localizacao_aproximada: true, raio_ofuscacao_m: 500 };
    
    if (settings.localizacao_aproximada !== false) {
      const raio = settings.raio_ofuscacao_m || 500;
      const obfuscated = obfuscateLocation(lat, lng, raio);
      const publicEndereco = removeStreetNumber(endereco);
      
      return {
        latitude: obfuscated.lat,
        longitude: obfuscated.lng,
        endereco: publicEndereco,
        isApproximate: true,
        precision: `~${raio}m`
      };
    }

    return {
      latitude: lat,
      longitude: lng,
      endereco: endereco,
      isApproximate: false,
      precision: 'exata'
    };
  }

  /**
   * Remove número da rua do endereço
   */
  function removeStreetNumber(endereco) {
    if (!endereco) return 'Região aproximada';
    return endereco
      .replace(/^\d+[\s,\-]*/, '')
      .replace(/,\s*\d+/, '')
      .replace(/\s+n[°º]?\s*\d+/gi, '')
      .replace(/\s+\d+$/, '')
      .trim() || 'Região aproximada';
  }

  // ====== PROTEÇÃO DE DADOS SENSÍVEIS ======

  /**
   * Mascara telefone para exibição pública
   */
  function maskPhone(phone) {
    if (!phone) return '';
    const clean = phone.replace(/\D/g, '');
    if (clean.length < 8) return '****-****';
    const visible = clean.slice(0, 4) + '****' + clean.slice(-2);
    return formatPhone(visible);
  }

  /**
   * Mascara email para exibição pública
   */
  function maskEmail(email) {
    if (!email) return '';
    const [user, domain] = email.split('@');
    if (!domain) return '***@***.com';
    const maskedUser = user[0] + '***';
    const domainParts = domain.split('.');
    const maskedDomain = domainParts[0][0] + '****.' + domainParts.slice(1).join('.');
    return maskedUser + '@' + maskedDomain;
  }

  /**
   * Formata telefone
   */
  function formatPhone(phone) {
    const clean = phone.replace(/\D/g, '');
    if (clean.length === 11) return `(${clean.slice(0,2)}) ${clean.slice(2,7)}-${clean.slice(7)}`;
    if (clean.length === 10) return `(${clean.slice(0,2)}) ${clean.slice(2,6)}-${clean.slice(6)}`;
    return phone;
  }

  /**
   * Prepara dados de pet para exibição pública (remove dados sensíveis)
   */
  function sanitizeForPublic(petData, userSettings) {
    if (!petData) return null;

    const publicData = { ...petData };

    // Mascarar dados sensíveis ANTES de expor
    if (publicData.contato_telefone) {
      publicData.contato_telefone_display = maskPhone(publicData.contato_telefone);
      delete publicData.contato_telefone; // Remover original
    }
    if (publicData.contato_email) {
      publicData.contato_email_display = maskEmail(publicData.contato_email);
      delete publicData.contato_email; // Remover original
    }

    if (publicData.latitude && publicData.longitude) {
      const settings = userSettings || { localizacao_aproximada: true, raio_ofuscacao_m: 500 };
      const pubLoc = getPublicLocation(
        publicData.latitude, 
        publicData.longitude, 
        publicData.endereco,
        settings
      );
      publicData.latitude_publica = pubLoc.latitude;
      publicData.longitude_publica = pubLoc.longitude;
      publicData.endereco_publico = pubLoc.endereco;
      publicData.localizacao_aproximada = pubLoc.isApproximate;
    }

    // Remover dados sensíveis que nunca devem ser públicos
    delete publicData.foto_hash;
    delete publicData.embedding;
    delete publicData.owner_uid;
    delete publicData.senha_hash;
    delete publicData.latitude;    // Manter apenas latitude_publica
    delete publicData.longitude;   // Manter apenas longitude_publica

    return publicData;
  }

  // ====== RATE LIMITING ======
  // Persistido no localStorage para sobreviver reloads de página (S-07)

  function checkRateLimit(action, maxAttempts = 5, windowMs = 60000) {
    const now = Date.now();
    const key = `_rl_${action}`;
    let attempts = [];
    try {
      attempts = JSON.parse(localStorage.getItem(key) || '[]');
    } catch { attempts = []; }
    attempts = attempts.filter(t => now - t < windowMs);
    if (attempts.length >= maxAttempts) {
      const waitTime = Math.ceil((windowMs - (now - attempts[0])) / 1000);
      throw new Error(`Muitas tentativas. Aguarde ${waitTime} segundos.`);
    }
    attempts.push(now);
    try { localStorage.setItem(key, JSON.stringify(attempts)); } catch {}
    return true;
  }

  // ====== VALIDAÇÃO DE DADOS ======

  function validateReportData(data) {
    const errors = [];
    if (!data.tipo_animal || !['cao', 'gato', 'outro'].includes(data.tipo_animal)) {
      errors.push('Tipo de animal inválido.');
    }
    if (!data.foto_comprimida && !data.foto_hash) {
      errors.push('Foto é obrigatória.');
    }
    if (data.foto_comprimida && data.foto_comprimida.length > 200000) {
      errors.push('Foto muito grande. Máximo 150KB.');
    }
    if (data.contato_telefone && data.contato_telefone.replace(/\D/g, '').length < 8) {
      errors.push('Telefone inválido.');
    }
    if (data.descricao && data.descricao.length > 1000) {
      errors.push('Descrição muito longa (máximo 1000 caracteres).');
    }
    if (errors.length > 0) throw new Error(errors.join(' '));
    return true;
  }

  function isSecureContext() {
    return window.isSecureContext || 
           window.location.protocol === 'https:' || 
           window.location.hostname === 'localhost';
  }

  // API pública
  return {
    // Senha
    hashPassword,
    verifyPassword,
    createPasswordHash,
    generateSalt,
    // Sessão
    generateSessionToken,
    saveSession,
    getSession,
    clearSession,
    // Sanitização
    sanitize,
    sanitizeObject,
    sanitizePhone,
    sanitizeEmail,
    normalizePhoneBR,
    validatePhoneBR,
    // Localização
    obfuscateLocation,
    getPublicLocation,
    removeStreetNumber,
    // Mascaramento
    maskPhone,
    maskEmail,
    formatPhone,
    sanitizeForPublic,
    // Rate limit
    checkRateLimit,
    validateReportData,
    isSecureContext
  };

})();
