// Encontre Pet - Service Worker v1.3.0
// Estratégia: Cache First para assets, Network First para API e Firestore
const CACHE_VERSION = 'encontre-pet-v1.3.0';
const DYNAMIC_CACHE = 'encontre-pet-dynamic-v1.0';
const API_CACHE = 'encontre-pet-api-v1.0';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
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
  '/manifest.json'
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
        return cache.addAll(STATIC_ASSETS.filter(url => !url.startsWith('http')));
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

  // CDN assets (Firebase SDK, TensorFlow, Fonts) - Cache First (stale-while-revalidate)
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
