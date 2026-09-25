// push-token — registra/remove o token de push (FCM) do aparelho.
// A coleção push_tokens é inacessível ao cliente (rules: coleção não listada);
// só este endpoint grava, amarrando o token ao Firebase Auth UID do chamador.
//
// owner_uid (ID do app u_xxx) só é gravado se a conta estiver vinculada ao
// chamador (firebase_auth_uids) — senão alguém registraria o próprio aparelho
// no ID de outra pessoa e passaria a receber os avisos dela.

const crypto = require('node:crypto');
const { callable, HttpsError, checkRateLimit } = require('./_lib/http');
const { getAdmin } = require('./_lib/firebase');

const LANGS = new Set(['pt', 'en', 'es']);

async function ownerUidVinculado(db, ownerUid, authUid) {
  if (!ownerUid || typeof ownerUid !== 'string' || ownerUid.startsWith('anon_') || ownerUid.length > 128) return '';
  if (ownerUid === authUid) return ownerUid;
  const snap = await db.collection('usuarios').doc(ownerUid).get();
  const uids = snap.exists ? (snap.data().firebase_auth_uids || []) : [];
  return Array.isArray(uids) && uids.includes(authUid) ? ownerUid : '';
}

exports.handler = callable(async ({ data, auth }) => {
  const { token, action = 'register', lang, ownerUid } = data;
  if (!token || typeof token !== 'string' || token.length > 4096) {
    throw new HttpsError('invalid-argument', 'token é obrigatório.');
  }
  checkRateLimit('push-token', auth.uid, 10);

  const admin = getAdmin();
  const db = admin.firestore();
  const ref = db.collection('push_tokens').doc(crypto.createHash('sha256').update(token).digest('hex'));

  if (action === 'unregister') {
    const snap = await ref.get();
    if (snap.exists && snap.data().owner_firebase_uid === auth.uid) await ref.delete();
    return { ok: true };
  }

  await ref.set({
    token,
    owner_firebase_uid: auth.uid,
    owner_uid: await ownerUidVinculado(db, ownerUid, auth.uid),
    lang: LANGS.has(lang) ? lang : 'pt',
    updated_at: admin.firestore.FieldValue.serverTimestamp()
  });
  return { ok: true };
});
