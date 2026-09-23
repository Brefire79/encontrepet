// check-email-exists — port da CF checkEmailExists (N-01).
// Unicidade de email no cadastro/recuperação sem listar usuarios.

const { callable, HttpsError, checkRateLimit } = require('./_lib/http');
const { findUserDocByEmail } = require('./_lib/shared');

exports.handler = callable(async ({ data, auth }) => {
  const { email } = data;
  if (!email || typeof email !== 'string') {
    throw new HttpsError('invalid-argument', 'email e obrigatorio.');
  }
  checkRateLimit('email-lookup', auth.uid, 10);
  const doc = await findUserDocByEmail(email.trim().toLowerCase());
  return { exists: !!doc };
});
