// ====================================================
// i18n.js — Sistema de internacionalização leve (vanilla JS)
// Suporta: data-i18n, data-i18n-placeholder, data-i18n-html, data-i18n-aria
// Salva preferência em localStorage, detecta idioma do navegador
// Locales carregados externamente via i18n_locales/*.js (pt.js, en.js, es.js)
// ====================================================

const I18n = (() => {
  'use strict';

  const STORAGE_KEY = 'encontrepet_lang';
  const DEFAULT_LANG = 'pt';
  const SUPPORTED = ['pt', 'en', 'es'];

  let currentLang = DEFAULT_LANG;
  let translations = {};

  // Sempre lê a referência atual (evita problema de ordem de carregamento)
  function getLocales() {
    return window.I18nLocales || {};
  }

  // ====== CORE API ======

  function detectLang() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;

    const nav = (navigator.language || navigator.userLanguage || 'pt').toLowerCase();
    if (nav.startsWith('en')) return 'en';
    if (nav.startsWith('es')) return 'es';
    return 'pt';
  }

  function refreshTranslations() {
    const locales = getLocales();
    const pt = locales.pt || {};
    const selected = locales[currentLang] || {};
    // merge: idioma escolhido sobrescreve pt; pt garante fallback
    translations = { ...pt, ...selected };
  }

  // Pequena espera para casos em que os arquivos de locale carregam depois
  function waitForLocales(maxWaitMs = 800) {
    const start = Date.now();
    return new Promise(resolve => {
      const tick = () => {
        const locales = getLocales();
        if ((locales.pt && Object.keys(locales.pt).length) || (Date.now() - start) >= maxWaitMs) {
          return resolve();
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  async function init() {
    currentLang = detectLang();
    document.documentElement.lang = currentLang === 'pt' ? 'pt-BR' : currentLang;

    // garante que os locales tenham chance de carregar
    await waitForLocales();

    refreshTranslations();
    applyAll();

    console.log(`[i18n] Idioma: ${currentLang}`);
  }

  function setLang(lang) {
    if (!SUPPORTED.includes(lang)) return;

    currentLang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang === 'pt' ? 'pt-BR' : lang;

    refreshTranslations();
    applyAll();

    window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
  }

  function interpolate(text, params) {
    if (!params) return text;
    return String(text).replace(/\{(\w+)\}/g, (_, k) => {
      const v = params[k];
      return (v === undefined || v === null) ? `{${k}}` : String(v);
    });
  }

  // t(key, params)
  // - fallback automático: idioma -> pt -> key
  // - params: { radius: 5 } substitui {radius}
  function t(key, params) {
    const locales = getLocales();
    const pt = (locales && locales.pt) ? locales.pt : {};

    let text = translations[key] ?? pt[key] ?? key;
    text = interpolate(text, params);
    return text;
  }

  // Opcional: plural simples (se quiser usar no futuro)
  // Ex: key="map.pets_count" e "map.pets_count_plural"
  function tp(key, count, params = {}) {
    const pluralKey = (count === 1) ? key : `${key}_plural`;
    return t(pluralKey, { ...params, count });
  }

  function getLang() {
    return currentLang;
  }

  function getSupported() {
    return [...SUPPORTED];
  }

  // ====== DOM TRANSLATION ======

  function applyAll() {
    // garante que, se os locales acabaram de carregar, a gente já mergeia
    refreshTranslations();

    // Parâmetros globais disponíveis em qualquer data-i18n (ex.: {version})
    const globais = { version: (typeof AppConfig !== 'undefined' && AppConfig.APP_VERSION) || '' };
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = t(key, globais);
      if (val !== key) el.textContent = val;
    });

    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.getAttribute('data-i18n-html');
      const val = t(key);
      if (val !== key) {
        // Sanitizar HTML: permitir apenas tags seguras de formatação
        const safe = val
          .replace(/<(?!\/?(strong|em|b|i|br|span|p|u)\b)[^>]*>/gi, '')
          .replace(/on\w+\s*=/gi, '')
          .replace(/javascript:/gi, '');
        el.innerHTML = safe;
      }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const val = t(key);
      if (val !== key) el.placeholder = val;
    });

    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
      const key = el.getAttribute('data-i18n-aria');
      const val = t(key);
      if (val !== key) el.setAttribute('aria-label', val);
    });

    // Botões de idioma (.lang-btn data-lang="pt|en|es")
    const langBtns = document.querySelectorAll('.lang-btn');
    langBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === currentLang);
    });
  }

  // ====== EXPORT ======
  return { init, setLang, t, tp, getLang, getSupported, applyAll };
})();