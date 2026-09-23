// _lib/avistamento-core.js — lógica portada do trigger onAvistamentoCreated
// (functions/src/index.ts ~412-626). Sem trigger de Firestore no Netlify, este
// core é invocado por:
//   1. process-avistamento (chamada do cliente logo após criar o doc);
//   2. sweep-avistamentos (scheduled — rede de segurança p/ clientes que
//      fecharam o app antes do retry).
// Idempotência: claim transacional no campo `processado` do doc público.

const { getAdmin } = require('./firebase');
const {
  MATCH_THRESHOLD,
  SEARCH_RADIUS_KM,
  haversineKm,
  buildWhatsAppLink,
  waitForPrivateAlertData
} = require('./shared');

// [S-08] Notificação de proximidade (avistamento SEM vínculo a pet).
async function notifyNearbyTutors(db, avistamento, avistamentoId, avistadorPrivateData, timestamp) {
  try {
    const lat = avistadorPrivateData.latitude_privada || avistamento.latitude_publica || 0;
    const lng = avistadorPrivateData.longitude_privada || avistamento.longitude_publica || 0;
    if (!lat || !lng) return;

    const tipo = avistamento.tipo_animal || 'outro';
    const raioKm = SEARCH_RADIUS_KM[tipo] ?? SEARCH_RADIUS_KM.outro;

    const petsSnap = await db.collection('pets_perdidos')
      .where('status', '==', 'ativo')
      .limit(100)
      .get();

    const proximos = petsSnap.docs.filter((d) => {
      const p = d.data();
      if (p.tipo_animal && p.tipo_animal !== tipo) return false;
      const pLat = p.latitude_publica || p.latitude || 0;
      const pLng = p.longitude_publica || p.longitude || 0;
      if (!pLat || !pLng) return false;
      return haversineKm(lat, lng, pLat, pLng) <= raioKm;
    }).slice(0, 5);

    const tipoLabel = tipo === 'cao' ? 'cão' : tipo === 'gato' ? 'gato' : 'animal';

    for (const petDoc of proximos) {
      const p = petDoc.data();
      let tutorUid = p.owner_firebase_uid || '';
      if (!tutorUid) {
        const priv = await db.collection('alert_privado').doc(`pets_perdidos_${petDoc.id}`).get();
        tutorUid = priv.exists ? (priv.data()?.owner_firebase_uid || '') : '';
      }
      if (!tutorUid && !p.owner_uid) continue;
      await db.collection('notificacoes').add({
        tipo: 'match_ia',
        pet_perdido_id: petDoc.id,
        avistamento_id: avistamentoId,
        mensagem: `📍 Um avistamento de ${tipoLabel} foi registrado a menos de ${raioKm}km do local de perda do seu pet.`,
        similaridade: 0,
        lida: false,
        destinatario_firebase_uid: tutorUid,
        destinatario_uid: p.owner_uid || '',
        data: new Date().toISOString(),
        timestamp
      });
    }
  } catch (e) {
    console.warn('[avistamento-core] notifyNearbyTutors falhou (não-fatal):', avistamentoId);
  }
}

/**
 * Processa um avistamento (idempotente).
 * @returns {Promise<{status:string}>} 'processado' | 'ja_processado' | 'nao_encontrado'
 */
async function processAvistamento(avistamentoId) {
  const admin = getAdmin();
  const db = admin.firestore();
  const avistRef = db.collection('avistamentos').doc(avistamentoId);

  // Claim transacional — evita processamento duplo (cliente + sweeper, ou
  // duas chamadas concorrentes do cliente).
  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(avistRef);
    if (!snap.exists) return { ok: false, status: 'nao_encontrado' };
    const d = snap.data() || {};
    if (d.processado === true) return { ok: false, status: 'ja_processado' };
    tx.update(avistRef, {
      processado: true,
      processado_em: admin.firestore.FieldValue.serverTimestamp(),
      processado_por: 'netlify_fn'
    });
    return { ok: true, avistamento: d };
  });
  if (!claim.ok) return { status: claim.status };

  try {
    await runCore(admin, db, avistRef, claim.avistamento, avistamentoId);
    return { status: 'processado' };
  } catch (err) {
    // Solta o claim para o sweeper tentar de novo.
    await avistRef.update({ processado: false, processado_erro: String(err.message || err) }).catch(() => {});
    throw err;
  }
}

// Corpo idêntico ao trigger original.
async function runCore(admin, db, avistSnapRef, avistamento, avistamentoId) {
  const timestamp = admin.firestore.FieldValue.serverTimestamp();

  const petId = avistamento.pet_perdido_id || avistamento.matchedLostPetId || '';
  const rawScore = avistamento.match_score ?? avistamento.matchedScore ?? avistamento.match_percentual ?? 0;
  const matchScore = typeof rawScore === 'number' ? rawScore : Number(rawScore) || 0;

  // [S-08] alert_privado é a fonte canônica do UID do avistador.
  const avistadorPrivateDocId = `avistamentos_${avistamentoId}`;
  const avistadorPrivateData = await waitForPrivateAlertData(avistadorPrivateDocId);
  const avistadorUid = avistamento.owner_firebase_uid || avistadorPrivateData.owner_firebase_uid || '';
  const avistadorOwnerUid = avistamento.owner_uid || avistadorPrivateData.owner_uid || '';

  if (!petId) {
    await db.collection('lgpd_access_log').add({
      tipo: 'avistamento_registrado',
      petId: '',
      avistamentoId,
      avistadorUid,
      matchScore,
      threshold: MATCH_THRESHOLD,
      timestamp
    });
    await notifyNearbyTutors(db, avistamento, avistamentoId, avistadorPrivateData, timestamp);
    return;
  }

  const petDoc = await db.collection('pets_perdidos').doc(petId).get();
  if (!petDoc.exists) return;
  const pet = petDoc.data() || {};

  const tutorPrivateDocId = `pets_perdidos_${petId}`;
  const tutorPrivateData = await waitForPrivateAlertData(tutorPrivateDocId, 1);

  const tutorUid = pet.owner_firebase_uid || pet.destinatario_firebase_uid
    || tutorPrivateData.owner_firebase_uid || '';
  const tutorOwnerUid = pet.owner_uid || tutorPrivateData.owner_uid || '';
  const petNome = pet.nome || pet.nome_pet || 'seu pet';

  // [S-08] Vínculos garantidos server-side.
  if (avistadorUid && tutorUid) {
    try {
      await db.collection('sighter_authorizations').doc(`${avistadorUid}_${petId}`).set({
        sighter_firebase_uid: avistadorUid,
        pet_id: petId,
        pet_owner_firebase_uid: tutorUid,
        sighting_id: avistamentoId,
        created_at: timestamp
      }, { merge: true });
      await db.collection('alert_privado').doc(avistadorPrivateDocId).set({
        linked_pet_owner_firebase_uid: tutorUid
      }, { merge: true });
      // Só UIDs (sem contato/localização): o tutor precisa do UID do avistador
      // para a confirmação bilateral de reunião (DB.getLinkedSightings).
      await db.collection('vinculos_avistamento').doc(avistamentoId).set({
        pet_id: petId,
        pet_owner_firebase_uid: tutorUid,
        sighter_firebase_uid: avistadorUid,
        sighter_owner_uid: avistadorOwnerUid,
        created_at: timestamp
      }, { merge: true });
    } catch (e) {
      console.warn('[avistamento-core] vínculo avistador↔pet falhou (não-fatal):', petId, avistamentoId);
    }
  }

  const tutorTelefone = tutorPrivateData.contato_telefone || pet.contato_telefone || pet.telefone_publico || '';
  const tutorEmail = tutorPrivateData.contato_email || pet.contato_email || pet.contato_email_publico || '';
  const tutorNome = tutorPrivateData.contato_nome || pet.contato_nome || pet.tutorNome || 'Tutor';
  const tutorTelPublico = pet.telefone_publico_ativo ?? true;
  const tutorEmailPublico = pet.email_publico_ativo === true || pet.contato_email_publico_ativo === true;

  const avistadorTelefone = avistadorPrivateData.contato_telefone || avistamento.telefone_publico || '';
  const avistadorNome = avistadorPrivateData.reportado_por || avistamento.reportado_por || 'Avistador';
  const avistadorTelPublico = avistamento.telefone_publico_ativo === true;

  const isHighMatch = matchScore >= MATCH_THRESHOLD;
  const conversaId = `${petId}_${avistamentoId}`;

  await db.collection('lgpd_access_log').add({
    tipo: isHighMatch ? 'match_alto_bilateral' : 'avistamento_registrado',
    petId,
    avistamentoId,
    avistadorUid,
    tutorUid,
    matchScore,
    threshold: MATCH_THRESHOLD,
    timestamp
  });

  if (!isHighMatch) {
    await db.collection('notificacoes').add({
      tipo: 'avistamento_registrado',
      destinatario_uid: tutorOwnerUid || tutorUid,
      destinatario_firebase_uid: tutorUid,
      owner_firebase_uid: tutorUid,
      petId,
      pet_id: petId,
      petNome,
      pet_nome: petNome,
      avistamentoId,
      avistamento_id: avistamentoId,
      matchScore,
      mensagem: `Novo avistamento de ${petNome} registrado (compatibilidade ${matchScore}%)`,
      lida: false,
      timestamp
    });
    return;
  }

  await db.collection('conversas').doc(conversaId).set({
    petId,
    petNome,
    avistamentoId,
    matchScore,
    participantes_firebase_uids: [tutorUid, avistadorUid].filter(Boolean),
    participantes_owner_uids: [tutorOwnerUid, avistadorOwnerUid].filter(Boolean),
    tutorUid,
    tutorOwnerUid,
    tutorNome,
    avistadorUid,
    avistadorOwnerUid,
    avistadorNome,
    status: 'ativa',
    origem: 'match_alto_bilateral',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastMessage: '',
    lastMessageAt: null
  }, { merge: true });

  const notifTutor = {
    tipo: 'match_alto_para_tutor',
    destinatario_uid: tutorOwnerUid || tutorUid,
    destinatario_firebase_uid: tutorUid,
    owner_firebase_uid: tutorUid,
    petId,
    pet_id: petId,
    petNome,
    pet_nome: petNome,
    avistamentoId,
    avistamento_id: avistamentoId,
    conversaId,
    conversa_id: conversaId,
    matchScore,
    avistadorNome,
    lida: false,
    timestamp
  };
  if (avistadorTelPublico && avistadorTelefone) {
    notifTutor.contato_telefone_avistador = avistadorTelefone;
    notifTutor.whatsapp_link = buildWhatsAppLink(avistadorTelefone);
  }
  await db.collection('notificacoes').add(notifTutor);

  const notifAvistador = {
    tipo: 'match_alto_para_avistador',
    destinatario_uid: avistadorOwnerUid || avistadorUid,
    destinatario_firebase_uid: avistadorUid,
    owner_firebase_uid: avistadorUid,
    petId,
    pet_id: petId,
    petNome,
    pet_nome: petNome,
    avistamentoId,
    avistamento_id: avistamentoId,
    conversaId,
    conversa_id: conversaId,
    matchScore,
    tutorNome,
    lida: false,
    timestamp
  };
  if (tutorTelPublico && tutorTelefone) {
    notifAvistador.contato_telefone_tutor = tutorTelefone;
    notifAvistador.whatsapp_link = buildWhatsAppLink(tutorTelefone);
  }
  if (tutorEmailPublico && tutorEmail) {
    notifAvistador.contato_email_tutor = tutorEmail;
  }
  await db.collection('notificacoes').add(notifAvistador);

  await avistSnapRef.update({
    match_confirmado: true,
    match_score: matchScore,
    conversaId,
    contato_revelado_em: timestamp
  });

  await db.collection('lgpd_access_log').add({
    tipo: 'contato_revelado_bilateral',
    petId,
    avistamentoId,
    avistadorUid,
    tutorUid,
    matchScore,
    camposReveladosParaTutor: avistadorTelPublico && avistadorTelefone ? ['telefone_avistador'] : [],
    camposReveladosParaAvistador: [
      ...(tutorTelPublico && tutorTelefone ? ['telefone_tutor'] : []),
      ...(tutorEmailPublico && tutorEmail ? ['email_tutor'] : [])
    ],
    timestamp
  });
}

module.exports = { processAvistamento };
