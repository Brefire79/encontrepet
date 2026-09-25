// _lib/http.js — envelope HTTP das Netlify Functions no protocolo "callable".
// Compatível com o shim do cliente (js/services/backend.js):
//   request : POST { "data": {...} }  +  Authorization: Bearer <Firebase ID token>
//   sucesso : 200 { "result": {...} }
//   erro    : 4xx/5xx { "error": { "status": "<codigo-firebase>", "message": "..." } }
// Os códigos de erro seguem os mesmos nomes do HttpsError das Cloud Functions
// para que os tratamentos existentes no cliente (cfErrorCode) continuem válidos.

const { getAdmin } = require('./firebase');

// CORS — espelha ALLOWED_CORS_ORIGINS de functions/src/index.ts
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:5173',
  'http://localhost:8888',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:8888',
  'https://encontre-pet-137d2.web.app',
  'https://encontre-pet-137d2.firebaseapp.com'
];
// Só o site do Encontre Pet e as prévias de deploy dele (<id>--encontre-pet).
// Antes aceitava qualquer *.netlify.app (sites de terceiros).
const NETLIFY_ORIGIN_RE = /^https:\/\/([a-z0-9-]+--)?encontre-pet\.netlify\.app$/;

const STATUS_TO_HTTP = {
  'invalid-argument': 400,
  'unauthenticated': 401,
  'permission-denied': 403,
  'not-found': 404,
  'already-exists': 409,
  'failed-precondition': 412,
  'resource-exhausted': 429,
  'unavailable': 503,
  'internal': 500
};

class HttpsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.httpCode = STATUS_TO_HTTP[status] || 500;
  }
}

function corsHeaders(event) {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) || NETLIFY_ORIGIN_RE.test(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '3600',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

async function verifyAuth(event) {
  const header = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return null;
  try {
    const admin = getAdmin();
    const decoded = await admin.auth().verifyIdToken(match[1]);
    return { uid: decoded.uid, token: decoded };
  } catch {
    return null;
  }
}

// Rate limit em memória por instância (mesma semântica dos Maps das CFs v2 —
// cada instância tinha o próprio Map; aqui cada lambda warm também tem).
const rateLimitStore = new Map();
function checkRateLimit(bucket, key, max, windowMs = 60_000) {
  const now = Date.now();
  const mapKey = `${bucket}:${key}`;
  const entry = rateLimitStore.get(mapKey);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(mapKey, { count: 1, resetAt: now + windowMs });
    return;
  }
  entry.count++;
  if (entry.count > max) {
    throw new HttpsError('resource-exhausted', 'Muitas solicitações. Aguarde 1 minuto.');
  }
}

/**
 * callable(handler, opts) → Netlify handler.
 * handler({ data, auth, ip, event }) — auth = { uid, token } | null.
 * opts.requireAuth (default true): rejeita sem ID token válido (anônimo do
 * Firebase Auth também tem token — mesmo comportamento do request.auth das CFs).
 */
function callable(handler, opts = {}) {
  const { requireAuth = true } = opts;
  return async (event) => {
    const headers = corsHeaders(event);

    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers, body: '' };
    }
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405, headers,
        body: JSON.stringify({ error: { status: 'invalid-argument', message: 'Use POST.' } })
      };
    }

    let data = {};
    try {
      const body = JSON.parse(event.body || '{}');
      data = body.data || {};
    } catch {
      return {
        statusCode: 400, headers,
        body: JSON.stringify({ error: { status: 'invalid-argument', message: 'JSON inválido.' } })
      };
    }

    try {
      const auth = await verifyAuth(event);
      if (requireAuth && !auth) {
        throw new HttpsError('unauthenticated', 'Autenticacao necessaria.');
      }
      const ip = (event.headers && (event.headers['x-nf-client-connection-ip']
        || event.headers['x-forwarded-for'] || '')) || '';
      const result = await handler({ data, auth, ip, event });
      return { statusCode: 200, headers, body: JSON.stringify({ result: result ?? {} }) };
    } catch (err) {
      if (err instanceof HttpsError) {
        return {
          statusCode: err.httpCode, headers,
          body: JSON.stringify({ error: { status: err.status, message: err.message } })
        };
      }
      console.error('[fn] erro interno:', err && err.message ? err.message : err);
      return {
        statusCode: 500, headers,
        body: JSON.stringify({ error: { status: 'internal', message: 'Erro interno.' } })
      };
    }
  };
}

module.exports = { callable, HttpsError, checkRateLimit };
