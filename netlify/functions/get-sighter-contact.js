// get-sighter-contact — port da CF getSighterContact.
// Tutor acessa contato do avistador (fluxo bidirecional), com log LGPD.

const { callable, HttpsError, checkRateLimit } = require('./_lib/http');
const { getAdmin } = require('./_lib/firebase');
const { sendSighterNotificationEmail } = require('./_lib/shared');

exports.handler = callable(async ({ data, auth, ip }) => {
  const { sightingId, petId } = data;
  if (!sightingId || !petId || typeof sightingId !== 'string' || typeof petId !== 'string') {
    throw new HttpsError('invalid-argument', 'sightingId e petId sao obrigatorios.');
  }

  const admin = getAdmin();
  const db = admin.firestore();
  const tutorUid = auth.uid;
  checkRateLimit('contact', tutorUid, 5);

  const petSnap = await db.collection('pets_perdidos').doc(petId).get();
  if (!petSnap.exists) throw new HttpsError('not-found', 'Pet nao encontrado.');
  const petData = petSnap.data();

  // [S-08] ownership também via alert_privado (campo público está em strip)
  let isOwner = petData.owner_firebase_uid === tutorUid;
  if (!isOwner) {
    const priv = await db.collection('alert_privado').doc(`pets_perdidos_${petId}`).get();
    isOwner = priv.exists && priv.data()?.owner_firebase_uid === tutorUid;
  }
  if (!isOwner) {
    throw new HttpsError('permission-denied', 'Apenas o tutor deste pet pode acessar o contato do avistador.');
  }

  const sightingSnap = await db.collection('avistamentos').doc(sightingId).get();
  if (!sightingSnap.exists) throw new HttpsError('not-found', 'Avistamento nao encontrado.');
  const sightingData = sightingSnap.data();
  if (sightingData.pet_perdido_id !== petId && sightingData.matchedLostPetId !== petId) {
    throw new HttpsError('permission-denied', 'Este avistamento nao esta vinculado ao seu pet.');
  }

  const privadoSnap = await db.collection('alert_privado').doc(`avistamentos_${sightingId}`).get();
  const privadoData = privadoSnap.exists ? privadoSnap.data() : null;

  const nome = sightingData.reportado_por || '';
  const telefonePublicoAtivo = sightingData.telefone_publico_ativo === true;
  const telefone = telefonePublicoAtivo
    ? (privadoData?.contato_telefone || sightingData.telefone_publico || '')
    : '';
  const email = privadoData?.contato_email || '';

  if (!telefone && !email) {
    let sighterEmail = '';
    let sighterNome = nome;
    try {
      if (sightingData.owner_uid) {
        const usuarioDoc = await db.collection('usuarios').doc(sightingData.owner_uid).get();
        if (usuarioDoc.exists) {
          const u = usuarioDoc.data();
          sighterEmail = u.email || '';
          sighterNome = u.nome || sighterNome;
        }
      }
      if (!sighterEmail && sightingData.owner_firebase_uid) {
        const snap = await db.collection('usuarios')
          .where('owner_firebase_uid', '==', sightingData.owner_firebase_uid)
          .limit(1).get();
        if (!snap.empty) {
          const u = snap.docs[0].data();
          sighterEmail = u.email || '';
          sighterNome = u.nome || sighterNome;
        }
      }
    } catch (lookupErr) {
      console.warn('[get-sighter-contact] lookup email avistador falhou:', lookupErr.message);
    }

    let emailSent = false;
    if (sighterEmail) {
      emailSent = await sendSighterNotificationEmail({
        to: sighterEmail,
        sighterNome,
        petNome: petData.nome_pet || 'um pet'
      });
      await db.collection('lgpd_access_log').add({
        tipo: 'contato_avistador_email_notificacao',
        petId,
        sightingId,
        petNome: petData.nome_pet || '',
        tutorFirebaseUid: tutorUid,
        sighterEmail: sighterEmail.replace(/(.{2}).+(@.+)/, '$1***$2'),
        emailSent,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ip
      });
    }
    return { telefone: '', email: '', nome: sighterNome, available: false, emailSent };
  }

  await db.collection('lgpd_access_log').add({
    tipo: 'contato_avistador_acesso',
    petId,
    sightingId,
    petNome: petData.nome_pet || '',
    tutorFirebaseUid: tutorUid,
    dadosAcessados: ['telefone', 'email', 'nome'].filter(k => {
      if (k === 'telefone') return !!telefone;
      if (k === 'email') return !!email;
      if (k === 'nome') return !!nome;
      return false;
    }),
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    ip
  });

  if (sightingData.owner_uid || sightingData.owner_firebase_uid) {
    await db.collection('notificacoes').add({
      tipo: 'contato_acessado_pelo_tutor',
      pet_id: petId,
      avistamento_id: sightingId,
      pet_nome: petData.nome_pet || 'Pet',
      mensagem: `O tutor de "${petData.nome_pet || 'um pet'}" acessou seu contato referente ao avistamento`,
      data: new Date().toISOString(),
      lida: false,
      destinatario_uid: sightingData.owner_uid || '',
      destinatario_firebase_uid: sightingData.owner_firebase_uid || '',
      owner_firebase_uid: sightingData.owner_firebase_uid || ''
    });
  }

  return { telefone: telefone || '', email: email || '', nome: nome || '', available: true };
});
