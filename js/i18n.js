// ====================================================
// i18n.js — Sistema de internacionalização leve (vanilla JS)
// Suporta: data-i18n, data-i18n-placeholder, data-i18n-html
// Salva preferência em localStorage, detecta idioma do navegador
// Locales carregados externamente via js/i18n/locales/*.js
// ====================================================

const I18n = (() => {
  'use strict';

  const STORAGE_KEY = 'encontrepet_lang';
  const DEFAULT_LANG = 'pt';
  const SUPPORTED = ['pt', 'en', 'es'];

  let currentLang = DEFAULT_LANG;
  let translations = {};

  // Locales carregados externamente (window.I18nLocales)
  const locales = window.I18nLocales || {};

  // ====== CORE API ======

  function detectLang() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;
    const nav = (navigator.language || navigator.userLanguage || 'pt').toLowerCase();
    if (nav.startsWith('en')) return 'en';
    if (nav.startsWith('es')) return 'es';
    return 'pt';
  }

  function init() {
    currentLang = detectLang();
    translations = locales[currentLang] || locales.pt;
    applyAll();
    console.log(`[i18n] Idioma: ${currentLang}`);
  }

  function setLang(lang) {
    if (!SUPPORTED.includes(lang)) return;
    currentLang = lang;
    translations = locales[lang] || locales.pt;
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang === 'pt' ? 'pt-BR' : lang;
    applyAll();
    window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
  }

  function t(key, params) {
    let text = translations[key] || locales.pt[key] || key;
    if (params) {
      Object.keys(params).forEach(k => {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]);
      });
    }
    return text;
  }

  function getLang() {
    return currentLang;
  }

  function getSupported() {
    return [...SUPPORTED];
  }

  // ====== DOM TRANSLATION ======

  function applyAll() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = t(key);
      if (val !== key) el.textContent = val;
    });

    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.getAttribute('data-i18n-html');
      const val = t(key);
      if (val !== key) el.innerHTML = val;
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

    const langBtns = document.querySelectorAll('.lang-btn');
    langBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === currentLang);
    });
  }

  // ====== EXPORT ======
  return { init, setLang, t, getLang, getSupported, applyAll };
})();
