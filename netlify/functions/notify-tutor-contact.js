// notify-tutor-contact — port da CF notifyTutorContact (S-08).
// Avistador envia o próprio telefone ao tutor; o destinatário é resolvido
// server-side via alert_privado (cliente não conhece o UID do tutor).

const { callable, HttpsError, checkRateLimit } = require('./_lib/http');
const { getAdmin } = require('./_lib/firebase');

exports.handler = callable(async ({ data, auth }) => {
  const { petId, phone, nome } = data;
  if (!petId || typeof petId !== 'string' || !phone || typeof phone !== 'string') {
    throw new HttpsError('invalid-argument', 'petId e phone sao obrigatorios.');
  }
  const cleanPhone = phone.replace(/[^\d\s()+-]/g, '').slice(0, 20);
  const cleanNome = String(nome || 'Avistador').slice(0, 80);
  checkRateLimit('contact', auth.uid, 5);

  const admin = getAdmin();
  const db = admin.firestore();
  const petDoc = await db.collection('pets_perdidos').doc(petId).get();
  if (!petDoc.exists) throw new HttpsError('not-found', 'Pet nao encontrado.');
  const pet = petDoc.data() || {};
  const petNome = pet.nome_pet || pet.nome || 'Pet';

  let tutorUid = pet.owner_firebase_uid || '';
  let tutorOwnerUid = pet.owner_uid || '';
  if (!tutorUid) {
    const priv = await db.collection('alert_privado').doc(`pets_perdidos_${petId}`).get();
    if (priv.exists) {
      tutorUid = priv.data()?.owner_firebase_uid || '';
      tutorOwnerUid = tutorOwnerUid || priv.data()?.owner_uid || '';
    }
  }
  if (!tutorUid && !tutorOwnerUid) {
    throw new HttpsError('failed-precondition', 'Tutor sem destinatario valido.');
  }

  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  await db.collection('notificacoes').add({
    tipo: 'avistamento_contato',
    pet_id: petId,
    pet_nome: petNome,
    sighter_nome: cleanNome,
    sighter_phone: cleanPhone,
    mensagem: `${cleanNome} viu «${petNome}» e quer entrar em contato: ${cleanPhone}`,
    data: new Date().toISOString(),
    timestamp,
    lida: false,
    destinatario_uid: tutorOwnerUid,
    destinatario_firebase_uid: tutorUid
  });

  await db.collection('lgpd_access_log').add({
    tipo: 'notif_contato',
    petId,
    de: auth.uid,
    para: tutorUid || tutorOwnerUid,
    timestamp
  });

  return { success: true };
});
