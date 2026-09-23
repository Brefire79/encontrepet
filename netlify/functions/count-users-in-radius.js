// count-users-in-radius — substitui a contagem client-side de db.js
// countUsersInRadius, que quebrou com a N-01 (usuarios não é mais listável).
// Retorna SÓ o número (nenhum dado pessoal sai).
//
// Custo: a Home chama isto a cada abertura. Ler `usuarios` inteiro por chamada
// (até 1000 reads) esgotaria a cota Spark (50k/dia) com ~50 visitas. Por isso
// a contagem usa um agregado `stats/usuarios_geo` (1 read) reconstruído no
// máximo 1×/dia, de forma preguiçosa, pela primeira chamada após expirar.
// Coordenadas arredondadas a 2 casas (~1 km) — minimização de dados (LGPD).

const { callable, HttpsError, checkRateLimit } = require('./_lib/http');
const { getAdmin } = require('./_lib/firebase');
const { haversineKm } = require('./_lib/shared');

const AGG_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

async function rebuildAggregate(db, aggRef) {
  const snap = await db.collection('usuarios').limit(1000).get();
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  const pontos = [];
  for (const doc of snap.docs) {
    const user = doc.data();
    if (user.is_anonymous) continue;
    const uLat = user.latitude || user.location?.lat || 0;
    const uLng = user.longitude || user.location?.lng || 0;
    if (!uLat || !uLng) continue;
    if (user.lastActive) {
      const lastActive = typeof user.lastActive === 'number' ? user.lastActive :
        (user.lastActive?.toMillis ? user.lastActive.toMillis() : new Date(user.lastActive).getTime());
      if (lastActive < cutoff) continue;
    }
    // Firestore não aceita arrays aninhados — pares achatados [lat, lng, lat, lng...]
    pontos.push(Math.round(uLat * 100) / 100, Math.round(uLng * 100) / 100);
  }
  await aggRef.set({ pontos, atualizado_em: Date.now() });
  return pontos;
}

exports.handler = callable(async ({ data, auth }) => {
  const lat = Number(data.lat);
  const lng = Number(data.lng);
  const radiusKm = Math.min(Math.max(Number(data.radiusKm) || 3, 0.1), 50);
  if (!lat || !lng || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new HttpsError('invalid-argument', 'lat e lng válidos são obrigatórios.');
  }
  checkRateLimit('count-users', auth.uid, 10);

  const db = getAdmin().firestore();
  const aggRef = db.collection('stats').doc('usuarios_geo');
  const agg = await aggRef.get();
  const fresh = agg.exists && Date.now() - (agg.data().atualizado_em || 0) < AGG_TTL_MS;
  const pontos = fresh ? (agg.data().pontos || []) : await rebuildAggregate(db, aggRef);

  let count = 0;
  for (let i = 0; i + 1 < pontos.length; i += 2) {
    if (haversineKm(lat, lng, pontos[i], pontos[i + 1]) <= radiusKm) count++;
  }
  return { count };
});
