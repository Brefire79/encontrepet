// Encontre Pet - Service Worker v1.2.0
// Estrategia: Cache First para assets, Network First para API e Firestore
// [FIX C5] CACHE_VERSION bumpado para forcar re-cache com os novos icones.
// [FIX C5] icons/icon-192.png e icons/icon-512.png agora pre-cacheados para
// que o PWA funcione corretamente offline no launcher do dispositivo.
// v1.19.0: fase de lançamento — fotos via Storage/thumb, feed sem onSnapshot,
// hardening N-01..N-04 e S-08 (auth/db/app novos).
// v1.19.1: fix geoDistKm — usa latitude_publica dos docs públicos (gates e
// score de distância do match voltam a funcionar).
// v1.20.0: backend migrado para Netlify Functions (custo zero sem Blaze) —
// novo js/services/backend.js (shim httpsCallable) + process-avistamento.
// v1.20.1: tela de notificações voltava vazia (query negada descartava as outras).
const CACHE_VERSION = 'encontre-pet-v1.20.1';
// Versionado junto com o app: antes era fixo e sobrevivia a todos os deploys,
// podendo servir cópias antigas de páginas/JS (caches.match procura em todos).
const DYNAMIC_CACHE = CACHE_VERSION + '-dynamic';
const API_CACHE = 'encontre-pet-api-v1.0';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app-config.js',
  '/js/i18n/locales/pt.js',
  '/js/i18n/locales/en.js',
  '/js/i18n/locales/es.js',
  '/js/i18n.js',
  '/js/firebase-config.js',
  '/js/security.js',
  '/js/auth.js',
  '/js/image-utils.js',
  '/js/geo-utils.js',
  '/js/ai-match.js',
  '/js/ai-vision.js',
  '/js/db.js',
  '/js/app.js',
  '/js/services/backend.js',
  '/js/services/image-hash.js',
  '/js/services/similarity.js',
  '/js/components/ModalDuplicateCase.js',
  '/manifest.json',
  // [FIX C5] Icones principais para PWA funcionar offline
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// CDN assets para cache dinâmico (Firebase SDK, TensorFlow, fontes, ícones)
const CDN_PATTERNS = [
  'gstatic.com/firebasejs',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

// Install
self.addEventListener('install', event => {
  console.log('[SW] Installing v' + CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => {
        console.log('[SW] Caching static assets');
        // cache: 'reload' ignora o cache HTTP do navegador — sem isso o SW
        // novo re-precacheava o JS antigo (servido antes como immutable/1 ano).
        return cache.addAll(STATIC_ASSETS
          .filter(url => !url.startsWith('http'))
          .map(url => new Request(url, { cache: 'reload' })));
      })
      .then(() => self.skipWaiting())
  );
});

// Activate
self.addEventListener('activate', event => {
  console.log('[SW] Activating v' + CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_VERSION && key !== DYNAMIC_CACHE && key !== API_CACHE)
          .map(key => {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (Firestore uses POST/streaming)
  if (request.method !== 'GET') return;

  // Backend Netlify Functions — nunca cachear (respostas dinâmicas/sensíveis)
  if (url.pathname.startsWith('/.netlify/')) return;

  // API requests (REST) - Network First
  if (url.pathname.startsWith('/tables/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Firestore API calls - let pass through (não cachear)
  if (url.hostname.includes('firestore.googleapis.com') || 
      url.hostname.includes('firebase') ||
      url.pathname.includes('google.firestore')) {
    return; // Let browser handle Firestore connections directly
  }

  // Font Awesome e Google Fonts — pass-through: browser usa style-src/font-src, não connect-src
  // Interceptar via SW forçaria connect-src, que não inclui essas origens de UI
  if (url.href.includes('cdn.jsdelivr.net') ||
      url.href.includes('fonts.googleapis.com') ||
      url.href.includes('fonts.gstatic.com')) {
    return;
  }

  // CDN assets (Firebase SDK, TensorFlow) - Cache First (stale-while-revalidate)
  if (CDN_PATTERNS.some(pattern => request.url.includes(pattern))) {
    event.respondWith(cacheFirstCDN(request));
    return;
  }

  // Static assets - Cache First
  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    if (request.mode !== 'navigate' && request.destination !== 'document') {
      return new Response('', { status: 503, statusText: 'Offline asset unavailable' });
    }
    return new Response('<h1>Sem conexão</h1><p>Verifique sua internet e tente novamente.</p>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

/**
 * Cache First para CDNs (Firebase SDK, TF.js, etc)
 * Com revalidação em background para manter atualizado
 */
async function cacheFirstCDN(request) {
  const cached = await caches.match(request);
  
  // Se tem cache, retorna imediatamente e revalida em background
  if (cached) {
    // Background revalidation (não bloqueia)
    fetch(request).then(response => {
      if (response.ok) {
        caches.open(DYNAMIC_CACHE).then(cache => cache.put(request, response));
      }
    }).catch(() => {}); // Silenciar erros de rede
    
    return cached;
  }

  // Se não tem cache, busca na rede
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return new Response('', { status: 503, statusText: 'CDN Offline' });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline', data: [], total: 0 }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Listen for update messages
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
