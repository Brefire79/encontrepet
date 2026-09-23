#!/usr/bin/env node
/**
 * Migração S-08 — tirar `owner_firebase_uid` dos documentos PÚBLICOS
 * (`pets_perdidos`, `avistamentos`), mantendo-o apenas em `alert_privado`
 * para uso das Firestore Rules.
 *
 * ⚠️  LEIA ANTES DE RODAR — BLOQUEIO ARQUITETURAL CONHECIDO  ⚠️
 * ----------------------------------------------------------------------
 * As regras atuais verificam ownership em docs públicos via:
 *     isOwner(data) = data.owner_uid == request.auth.uid
 *                  || data.owner_firebase_uid == request.auth.uid
 * Como `owner_uid` é o ID customizado `u_xxx` (que NÃO é igual ao Firebase
 * Auth UID), na prática só `owner_firebase_uid == request.auth.uid` casa.
 *
 * Se você REMOVER `owner_firebase_uid` dos docs públicos SEM antes
 * reescrever e testar as rules, o dono PERDE create/update/delete do
 * próprio alerta (ownership quebra para todo mundo).
 *
 * Por isso este script tem DUAS FASES separadas:
 *   1) backfill  -> copia owner_firebase_uid p/ alert_privado (SEGURO; default).
 *                   Também grava linked_pet_owner_firebase_uid no alert_privado
 *                   dos avistamentos vinculados (pet_perdido_id/matchedLostPetId),
 *                   necessário ao cross-read do tutor (S-08 leitura) que habilita
 *                   a confirmação bilateral em dados legados após o strip.
 *   2) strip     -> remove owner_firebase_uid dos docs públicos (DESTRUTIVO;
 *                   só rode DEPOIS de reescrever rules e validar no emulator)
 *
 * Sequência recomendada:
 *   a) node scripts/migrate-s08-owner-firebase-uid.js --phase=backfill --apply
 *   b) Reescrever firestore.rules para ownership não depender do campo público
 *      (ex.: verificar via get() no alert_privado correspondente) e
 *      VALIDAR com o Firestore Rules emulator (anônimo/dono/terceiro).
 *   c) Deploy das rules novas.
 *   d) node scripts/migrate-s08-owner-firebase-uid.js --phase=strip --apply --i-understand-risk
 *
 * Características: idempotente, DRY-RUN por padrão.
 *
 * Uso:
 *   export GOOGLE_APPLICATION_CREDENTIALS="./serviceAccountKey.json"
 *   node scripts/migrate-s08-owner-firebase-uid.js --phase=backfill            # dry-run
 *   node scripts/migrate-s08-owner-firebase-uid.js --phase=backfill --apply
 *   node scripts/migrate-s08-owner-firebase-uid.js --phase=strip --apply --i-understand-risk
 */

'use strict';

const path = require('path');
const admin = require('firebase-admin');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const RISK_OK = args.includes('--i-understand-risk');
const phaseArg = (args.find((a) => a.startsWith('--phase=')) || '--phase=backfill').split('=')[1];
const PHASE = phaseArg === 'strip' ? 'strip' : 'backfill';

const PUBLIC_COLLECTIONS = ['pets_perdidos', 'avistamentos'];

function privateDocId(collection, alertId) {
  // Padrão usado pelo app: alert_privado/{collection}_{alertId}
  return `${collection}_${alertId}`;
}

function initAdmin() {
  if (admin.apps.length) return;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return;
  }
  try {
    const svc = require(path.resolve(process.cwd(), 'serviceAccountKey.json'));
    admin.initializeApp({ credential: admin.credential.cert(svc) });
  } catch (e) {
    console.error('\n[ERRO] Credencial não encontrada.');
    console.error('Defina GOOGLE_APPLICATION_CREDENTIALS ou coloque serviceAccountKey.json na raiz.');
    process.exit(1);
  }
}

// Resolve o owner_firebase_uid do tutor de um pet vinculado.
// Durante o backfill o doc público do pet ainda tem o campo; se já estiver
// stripado, cai para o alert_privado correspondente (backfillado antes, pois
// pets_perdidos é processado primeiro em PUBLIC_COLLECTIONS).
async function resolvePetOwnerFbUid(db, petId, cache) {
  if (!petId) return '';
  if (cache.has(petId)) return cache.get(petId);
  let uid = '';
  try {
    const petSnap = await db.collection('pets_perdidos').doc(petId).get();
    uid = petSnap.exists ? (petSnap.data()?.owner_firebase_uid || '') : '';
    if (!uid) {
      const privSnap = await db.collection('alert_privado').doc(privateDocId('pets_perdidos', petId)).get();
      uid = privSnap.exists ? (privSnap.data()?.owner_firebase_uid || '') : '';
    }
  } catch (_) { uid = ''; }
  cache.set(petId, uid);
  return uid;
}

async function backfill(db) {
  let scanned = 0;
  let copied = 0;
  let alreadyOk = 0;
  let noUid = 0;
  let linkedBackfilled = 0; // [S-08 leitura] linked_pet_owner_firebase_uid gravados
  const petOwnerCache = new Map();

  for (const col of PUBLIC_COLLECTIONS) {
    const snap = await db.collection(col).get();
    for (const doc of snap.docs) {
      scanned++;
      const data = doc.data() || {};
      const fbUid = data.owner_firebase_uid;

      const privRef = db.collection('alert_privado').doc(privateDocId(col, doc.id));
      const privSnap = await privRef.get();
      const priv = privSnap.exists ? (privSnap.data() || {}) : {};

      // [S-08 leitura] Avistamento vinculado precisa de linked_pet_owner_firebase_uid
      // no seu alert_privado para o cross-read do tutor (confirmação bilateral)
      // funcionar após o strip. Resolvido a partir do pet vinculado.
      if (col === 'avistamentos') {
        const linkedPetId = data.pet_perdido_id || data.matchedLostPetId || '';
        if (linkedPetId && !priv.linked_pet_owner_firebase_uid) {
          const tutorUid = await resolvePetOwnerFbUid(db, linkedPetId, petOwnerCache);
          if (tutorUid) {
            console.log(`- avistamentos/${doc.id}: gravar linked_pet_owner_firebase_uid (tutor do pet ${linkedPetId})`);
            if (APPLY) {
              await privRef.set({ linked_pet_owner_firebase_uid: tutorUid }, { merge: true });
              linkedBackfilled++;
            }
          }
        }
      }

      if (!fbUid) { noUid++; continue; }
      if (priv.owner_firebase_uid === fbUid) { alreadyOk++; continue; } // idempotente

      console.log(`- ${col}/${doc.id}: copiar owner_firebase_uid -> alert_privado/${privateDocId(col, doc.id)}`);
      if (!APPLY) continue;

      await privRef.set(
        {
          owner_firebase_uid: fbUid,
          ...(data.owner_uid ? { owner_uid: data.owner_uid } : {}),
        },
        { merge: true }
      );
      copied++;
    }
  }

  console.log('\n=== Resumo (backfill) ===');
  console.log(`Docs públicos lidos:        ${scanned}`);
  console.log(`Sem owner_firebase_uid:     ${noUid}`);
  console.log(`Já presentes no privado:    ${alreadyOk}`);
  if (APPLY) console.log(`Copiados p/ alert_privado:  ${copied}`);
  if (APPLY) console.log(`linked_pet_owner gravados:  ${linkedBackfilled}`);
  else console.log('\nℹ️  DRY-RUN — nada foi escrito. Use --apply.');
}

async function strip(db) {
  if (!RISK_OK) {
    console.error('\n⛔ FASE STRIP BLOQUEADA.');
    console.error('Esta fase remove owner_firebase_uid dos docs públicos e QUEBRA ownership');
    console.error('se as rules ainda dependerem desse campo. Só prossiga após reescrever e');
    console.error('testar as rules no emulator. Então rode com --i-understand-risk.');
    process.exit(2);
  }

  let scanned = 0;
  let stripped = 0;
  let missingPrivate = 0;

  for (const col of PUBLIC_COLLECTIONS) {
    const snap = await db.collection(col).get();
    for (const doc of snap.docs) {
      scanned++;
      const data = doc.data() || {};
      if (data.owner_firebase_uid === undefined) continue; // idempotente

      // Garantia de segurança: só remove se o privado já tiver o UID (backfill feito)
      const privSnap = await db.collection('alert_privado').doc(privateDocId(col, doc.id)).get();
      const priv = privSnap.exists ? (privSnap.data() || {}) : {};
      if (priv.owner_firebase_uid !== data.owner_firebase_uid) {
        missingPrivate++;
        console.warn(`! ${col}/${doc.id}: backfill ausente no privado — PULANDO (rode backfill antes).`);
        continue;
      }

      console.log(`- ${col}/${doc.id}: remover owner_firebase_uid do doc público`);
      if (!APPLY) continue;
      await doc.ref.update({ owner_firebase_uid: admin.firestore.FieldValue.delete() });
      stripped++;
    }
  }

  console.log('\n=== Resumo (strip) ===');
  console.log(`Docs públicos lidos:        ${scanned}`);
  console.log(`Pulados (sem backfill):     ${missingPrivate}`);
  if (APPLY) console.log(`Campo removido:             ${stripped}`);
  else console.log('\nℹ️  DRY-RUN — nada foi escrito. Use --apply.');
}

async function run() {
  initAdmin();
  const db = admin.firestore();
  console.log(`\n=== Migração S-08 — fase: ${PHASE} — modo: ${APPLY ? 'APPLY' : 'DRY-RUN'} ===\n`);
  if (PHASE === 'backfill') await backfill(db);
  else await strip(db);
}

run().catch((err) => {
  console.error('\n[FALHA] Migração abortada:', err);
  process.exit(1);
});
