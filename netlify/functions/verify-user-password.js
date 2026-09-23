// verify-user-password — port da CF verifyUserPassword (S-03).
// Verifica a senha contra senhas_usuarios sem expor o hash ao cliente.

const { callable, HttpsError, checkRateLimit } = require('./_lib/http');
const { getAdmin } = require('./_lib/firebase');
const { verifySha256SaltHash } = require('./_lib/shared');

exports.handler = callable(async ({ data, auth }) => {
  const { uid, password } = data;
  if (!uid || !password) {
    throw new HttpsError('invalid-argument', 'uid e password sao obrigatorios.');
  }
  checkRateLimit('login', auth.uid, 10);

  const db = getAdmin().firestore();
  const doc = await db.collection('senhas_usuarios').doc(uid).get();
  if (!doc.exists) throw new HttpsError('unauthenticated', 'Credenciais invalidas.');

  const storedHash = doc.data()?.senhaHash || '';
  if (!verifySha256SaltHash(password, storedHash)) {
    throw new HttpsError('unauthenticated', 'Credenciais invalidas.');
  }
  return { valid: true };
});
