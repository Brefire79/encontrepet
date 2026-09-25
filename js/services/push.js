/**
 * Push — avisos no celular via Firebase Cloud Messaging (gratuito no Spark).
 *
 * O navegador só deixa pedir permissão após um toque do usuário, então
 * enable() é chamado por botões (tela de Notificações e convite pós-reporte).
 * O token do aparelho vai para o backend (push-token), que o amarra ao
 * Firebase Auth UID; o envio acontece nas Netlify Functions que já criam as
 * notificações. O sw.js mostra o aviso e abre o app no toque.
 *
 * Desligado enquanto AppConfig.PUSH_VAPID_KEY estiver vazio.
 */
const Push = (() => {
  'use strict';

  const STORE_KEY = 'ep_push_token';

  function storedToken() {
    try { return localStorage.getItem(STORE_KEY) || ''; } catch { return ''; }
  }
  function storeToken(t) {
    try { t ? localStorage.setItem(STORE_KEY, t) : localStorage.removeItem(STORE_KEY); } catch { /* sem storage */ }
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent || '');
  }
  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  function baseSupported() {
    return !!(typeof AppConfig !== 'undefined' && AppConfig.PUSH_VAPID_KEY &&
      'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window &&
      typeof firebase !== 'undefined' && firebase.messaging);
  }

  /**
   * 'enabled' | 'available' | 'blocked' | 'ios_install' | 'unsupported'
   */
  function status() {
    if (!baseSupported()) {
      // iPhone só recebe push com o app instalado na tela de início (iOS 16.4+)
      if (typeof AppConfig !== 'undefined' && AppConfig.PUSH_VAPID_KEY && isIOS() && !isStandalone()) return 'ios_install';
      return 'unsupported';
    }
    if (Notification.permission === 'denied') return 'blocked';
    if (Notification.permission === 'granted' && storedToken()) return 'enabled';
    return 'available';
  }

  async function getToken() {
    const reg = await navigator.serviceWorker.ready;
    return firebase.messaging().getToken({
      vapidKey: AppConfig.PUSH_VAPID_KEY,
      serviceWorkerRegistration: reg
    });
  }

  async function register(token) {
    const functions = FirebaseConfig.getFunctions?.();
    if (!functions?.httpsCallable) throw new Error('backend indisponível');
    await functions.httpsCallable('pushToken')({
      token,
      action: 'register',
      lang: (typeof I18n !== 'undefined' && I18n.getLang?.()) || 'pt',
      ownerUid: (typeof Auth !== 'undefined' && Auth.getUID?.()) || ''
    });
    storeToken(token);
  }

  /** Pede permissão e registra o aparelho. Retorna o novo status(). */
  async function enable() {
    if (!baseSupported()) return status();
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return status();
    const token = await getToken();
    if (!token) throw new Error('sem token');
    await register(token);
    return status();
  }

  async function disable() {
    const token = storedToken();
    storeToken('');
    try {
      if (token) {
        await FirebaseConfig.getFunctions?.().httpsCallable('pushToken')({ token, action: 'unregister' });
      }
      await firebase.messaging().deleteToken();
    } catch (e) { console.warn('[Push] disable:', e.message); }
    return status();
  }

  /**
   * Chamado no início do app: se já há permissão, confere se o token mudou
   * (o FCM troca tokens de tempos em tempos) e reenvia. Sem prompt.
   */
  async function refresh() {
    try {
      if (!baseSupported() || Notification.permission !== 'granted' || !storedToken()) return;
      const token = await getToken();
      if (token && token !== storedToken()) await register(token);
    } catch (e) { console.warn('[Push] refresh:', e.message); }
  }

  return { status, enable, disable, refresh };
})();

if (typeof window !== 'undefined') window.Push = Push;
