// login-user — port da CF loginUser (N-01).
// Resolve email → perfil SEM listar `usuarios` no cliente. Retorna o perfil
// apenas com credencial válida. senha_hash nunca sai na resposta.

const { callable, HttpsError, checkRateLimit } = require('./_lib/http');
const { getAdmin } = require('./_lib/firebase');
const { findUserDocByEmail, verifySha256SaltHash } = require('./_lib/shared');

exports.handler = callable(async ({ data, auth }) => {
  const { email, password } = data;
  if (!email || typeof email !== 'string') {
    throw new HttpsError('invalid-argument', 'email e obrigatorio.');
  }
  checkRateLimit('login', auth.uid, 10);

  const admin = getAdmin();
  const db = admin.firestore();
  const normalizedEmail = email.trim().toLowerCase();
  const GENERIC = 'Credenciais invalidas.';

  const doc = await findUserDocByEmail(normalizedEmail);
  if (!doc) throw new HttpsError('unauthenticated', GENERIC);
  const userData = doc.data();

  // 1) O Firebase Auth já provou a posse deste e-mail — mas só vale se o
  //    e-mail estiver VERIFICADO (ex.: login com Google, reset por e-mail) ou
  //    se este login já estiver vinculado ao perfil. Antes bastava o e-mail
  //    do token: quem criasse uma conta Auth com o e-mail de um perfil sem
  //    conta Auth assumia o perfil (avaliação de lançamento 2026-09-25).
  const tokenEmail = (auth.token?.email || '').toLowerCase();
  const emailConfere = !!tokenEmail && tokenEmail === normalizedEmail;
  const jaVinculado = Array.isArray(userData.firebase_auth_uids) && userData.firebase_auth_uids.includes(auth.uid);
  let valid = emailConfere && (auth.token?.email_verified === true || jaVinculado);

  // 2) Caso contrário, verificar a senha (senhas_usuarios; fallback legado)
  if (!valid) {
    if (!password || typeof password !== 'string') {
      throw new HttpsError('unauthenticated', GENERIC);
    }
    const senhaDoc = await db.collection('senhas_usuarios').doc(doc.id).get();
    const storedHash = senhaDoc.exists
      ? (senhaDoc.data()?.senhaHash || '')
      : (userData.senha_hash || ''); // docs legados pré-S-03
    valid = verifySha256SaltHash(password, storedHash);
  }

  if (!valid) throw new HttpsError('unauthenticated', GENERIC);
  if (userData.status === 'bloqueado') {
    throw new HttpsError('permission-denied', 'Esta conta foi bloqueada.');
  }

  // Vincula o Firebase Auth UID atual ao doc (isBoundUser nas rules — N-01).
  try {
    await doc.ref.update({
      firebase_auth_uids: admin.firestore.FieldValue.arrayUnion(auth.uid)
    });
  } catch (e) {
    console.warn('[login-user] vínculo firebase_auth_uid falhou (não-fatal)');
  }

  const profile = { id: doc.id, ...userData };
  delete profile.senha_hash;
  return { user: profile };
});
