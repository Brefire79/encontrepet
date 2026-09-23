// save-user-password — port da CF saveUserPassword (S-03).
// Grava o hash na coleção senhas_usuarios (read/write:false nas rules).

const { callable, HttpsError } = require('./_lib/http');
const { getAdmin } = require('./_lib/firebase');

exports.handler = callable(async ({ data, auth }) => {
  const { uid, senhaHash } = data;
  if (!uid || !senhaHash || typeof uid !== 'string' || typeof senhaHash !== 'string') {
    throw new HttpsError('invalid-argument', 'uid e senhaHash sao obrigatorios.');
  }
  const admin = getAdmin();
  await admin.firestore().collection('senhas_usuarios').doc(uid).set({
    senhaHash,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ownerFirebaseUid: auth.uid
  }, { merge: true });
  return { success: true };
});
