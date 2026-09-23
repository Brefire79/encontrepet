/**
 * Backend — shim compatível com firebase.functions().httpsCallable().
 *
 * As Cloud Functions foram substituídas por Netlify Functions (decisão
 * 2026-07-20: custo zero sem Blaze — ver PLANO_ESTRUTURACAO.md §1).
 * Este shim mantém a MESMA assinatura usada em app.js/auth.js/db.js:
 *
 *   const fn = functions.httpsCallable('getTutorContact');
 *   const res = await fn({ petId });    // res.data = payload
 *
 * Protocolo (espelha _lib/http.js do backend):
 *   POST /.netlify/functions/<nome-kebab>  body {data} + Bearer <ID token>
 *   200 → { result }   |   erro → { error: { status, message } }
 * Erros chegam como Error com .code = 'functions/<status>' — igual ao SDK,
 * então cfErrorCode() e os catch existentes continuam funcionando.
 */
const Backend = (() => {
  'use strict';

  const BASE = '/.netlify/functions';
  const TIMEOUT_MS = 20000;

  // Mapeia o nome camelCase das CFs antigas → arquivo kebab-case da function.
  const NAME_MAP = {
    getTutorContact: 'get-tutor-contact',
    getSighterContact: 'get-sighter-contact',
    saveUserPassword: 'save-user-password',
    verifyUserPassword: 'verify-user-password',
    loginUser: 'login-user',
    checkEmailExists: 'check-email-exists',
    notifyTutorContact: 'notify-tutor-contact',
    processAvistamento: 'process-avistamento',
    countUsersInRadius: 'count-users-in-radius'
  };

  function toKebab(name) {
    return NAME_MAP[name] || name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  }

  async function getIdToken() {
    try {
      if (typeof firebase !== 'undefined' && firebase.auth) {
        const user = firebase.auth().currentUser;
        if (user) return await user.getIdToken();
      }
    } catch (e) {
      console.warn('[Backend] ID token indisponível:', e.message);
    }
    return '';
  }

  function httpsCallable(name) {
    const url = `${BASE}/${toKebab(name)}`;
    return async function call(payload = {}) {
      const token = await getIdToken();
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;

      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ data: payload }),
          signal: controller ? controller.signal : undefined
        });
      } catch (netErr) {
        const err = new Error('Backend indisponível: ' + (netErr.message || 'falha de rede'));
        err.code = 'functions/unavailable';
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
      }

      let json = {};
      try { json = await res.json(); } catch { /* corpo vazio */ }

      if (!res.ok || json.error) {
        const status = json.error?.status || (res.status === 404 ? 'not-found' : 'internal');
        const err = new Error(json.error?.message || `Erro ${res.status}`);
        err.code = 'functions/' + status;
        throw err;
      }
      return { data: json.result ?? {} };
    };
  }

  return { httpsCallable, isNetlifyBackend: true };
})();

if (typeof window !== 'undefined') window.Backend = Backend;
