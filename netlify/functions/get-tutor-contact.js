// get-tutor-contact — port da CF getTutorContact (LGPD).
// Revela contato do tutor só para quem tem avistamento vinculado (S-05),
// sempre com log em lgpd_access_log.

const { callable, HttpsError, checkRateLimit } = require('./_lib/http');
const { getAdmin } = require('./_lib/firebase');
const { sendTutorNotificationEmail } = require('./_lib/shared');

exports.handler = callable(async ({ data, auth, ip }) => {
  const { petId } = data;
  if (!petId || typeof petId !== 'string') {
    throw new HttpsError('invalid-argument', 'petId é obrigatório.');
  }

  const admin = getAdmin();
  const db = admin.firestore();
  const requesterUid = auth.uid;
  checkRateLimit('contact', requesterUid, 5);

  const petSnap = await db.collection('pets_perdidos').doc(petId).get();
  if (!petSnap.exists) throw new HttpsError('not-found', 'Pet não encontrado.');
  const petData = petSnap.data() || {};

  if (petData.owner_firebase_uid === requesterUid) {
    throw new HttpsError('permission-denied', 'Você é o dono deste pet. Use seus dados privados.');
  }

  // S-05: exige avistamento vinculado (direto ou via match)
  const sightingSnap = await db.collection('avistamentos')
    .where('owner_firebase_uid', '==', requesterUid)
    .where('pet_perdido_id', '==', petId)
    .limit(1)
    .get();

  if (sightingSnap.empty) {
    const highScoreSnap = await db.collection('avistamentos')
      .where('owner_firebase_uid', '==', requesterUid)
      .where('matchedLostPetId', '==', petId)
      .limit(1)
      .get();
    if (highScoreSnap.empty) {
      throw new HttpsError(
        'permission-denied',
        'Registre um avistamento deste pet antes de solicitar o contato do tutor.'
      );
    }
  }

  const privateSnap = await db.collection('alert_privado').doc(`pets_perdidos_${petId}`).get();
  const privateData = privateSnap.exists ? privateSnap.data() : null;

  const telefone = privateData?.contato_telefone || petData.contato_telefone || '';
  const emailPublicoAtivo = petData.email_publico_ativo === true || petData.contato_email_publico_ativo === true;
  const email = emailPublicoAtivo ? (privateData?.contato_email || petData.contato_email || '') : '';
  const nome = petData.contato_nome || petData.nome_pet || '';

  if (!telefone && !email) {
    // Sem contato público — busca e-mail do perfil do tutor e o notifica
    let tutorEmail = '';
    let tutorNome = nome;
    try {
      if (petData.owner_firebase_uid) {
        const userSnap = await db.collection('usuarios')
          .where('owner_firebase_uid', '==', petData.owner_firebase_uid)
          .limit(1).get();
        if (!userSnap.empty) {
          const u = userSnap.docs[0].data();
          tutorEmail = u.email || '';
          tutorNome = u.nome || tutorNome;
        }
      }
      if (!tutorEmail && petData.owner_uid) {
        const ownerDoc = await db.collection('usuarios').doc(petData.owner_uid).get();
        if (ownerDoc.exists) {
          const u = ownerDoc.data();
          tutorEmail = u.email || '';
          tutorNome = u.nome || tutorNome;
        }
      }
    } catch (lookupErr) {
      console.warn('[get-tutor-contact] lookup email tutor falhou:', lookupErr.message);
    }

    let emailSent = false;
    if (tutorEmail) {
      emailSent = await sendTutorNotificationEmail({
        to: tutorEmail,
        tutorNome,
        petNome: petData.nome_pet || 'seu pet'
      });
      await db.collection('lgpd_access_log').add({
        tipo: 'contato_email_notificacao',
        petId,
        petNome: petData.nome_pet || '',
        requesterFirebaseUid: requesterUid,
        tutorEmail: tutorEmail.replace(/(.{2}).+(@.+)/, '$1***$2'),
        emailSent,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ip
      });
    }
    return { telefone: '', email: '', nome: tutorNome, available: false, emailSent };
  }

  await db.collection('lgpd_access_log').add({
    tipo: 'contato_tutor_acesso',
    petId,
    petNome: petData.nome_pet || '',
    requesterFirebaseUid: requesterUid,
    dadosAcessados: ['telefone', 'email', 'nome'].filter(k => {
      if (k === 'telefone') return !!telefone;
      if (k === 'email') return !!email;
      if (k === 'nome') return !!nome;
      return false;
    }),
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    ip
  });

  if (petData.owner_uid || petData.owner_firebase_uid) {
    await db.collection('notificacoes').add({
      tipo: 'contato_acessado',
      pet_id: petId,
      pet_nome: petData.nome_pet || 'Pet',
      mensagem: `Alguém visualizou seu contato referente a "${petData.nome_pet || 'seu pet'}"`,
      data: new Date().toISOString(),
      lida: false,
      destinatario_uid: petData.owner_uid || '',
      destinatario_firebase_uid: petData.owner_firebase_uid || '',
      owner_firebase_uid: petData.owner_firebase_uid || ''
    });
  }

  return { telefone: telefone || '', email: email || '', nome: nome || '', available: true };
});
