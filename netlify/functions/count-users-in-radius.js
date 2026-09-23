// count-users-in-radius — substitui a contagem client-side de db.js
// countUsersInRadius, que quebrou com a N-01 (usuarios não é mais listável).
// Admin SDK conta server-side e retorna SÓ o número (nenhum dado pessoal sai).

const { callable, HttpsError, checkRateLimit } = require('./_lib/http');
const { getAdmin } = require('./_lib/firebase');
const { haversineKm } = require('./_lib/shared');

exports.handler = callable(async ({ data, auth }) => {
  const lat = Number(data.lat);
  const lng = Number(data.lng);
  const radiusKm = Math.min(Math.max(Number(data.radiusKm) || 3, 0.1), 50);
  if (!lat || !lng || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new HttpsError('invalid-argument', 'lat e lng válidos são obrigatórios.');
  }
  checkRateLimit('count-users', auth.uid, 10);

  const db = getAdmin().firestore();
  // Mesmo critério do client antigo: não-anônimos, com localização,
  // ativos nos últimos 30 dias (quando o campo existe).
  const snap = await db.collection('usuarios').limit(1000).get();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  let count = 0;
  for (const doc of snap.docs) {
    const user = doc.data();
    if (user.is_anonymous) continue;
    const uLat = user.latitude || user.location?.lat || 0;
    const uLng = user.longitude || user.location?.lng || 0;
    if (!uLat || !uLng) continue;
    if (user.lastActive) {
      const lastActive = typeof user.lastActive === 'number' ? user.lastActive :
        (user.lastActive?.toMillis ? user.lastActive.toMillis() : new Date(user.lastActive).getTime());
      if (lastActive < thirtyDaysAgo) continue;
    }
    if (haversineKm(lat, lng, uLat, uLng) <= radiusKm) count++;
  }
  return { count };
});
