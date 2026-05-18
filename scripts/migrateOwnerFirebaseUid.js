/**
 * [FIX C12] migrateOwnerFirebaseUid.js
 *
 * Script one-shot para corrigir docs antigos que foram salvos com
 * owner_firebase_uid='' (race condition entre criacao do doc e auth anonimo
 * Firebase ficar pronto).
 *
 * O que faz:
 *   1. Lista docs em pets_perdidos, avistamentos e alert_privado com
 *      owner_firebase_uid vazio ou inexistente.
 *   2. Para cada doc, busca o user em "usuarios" pelo owner_uid (u_xxx).
 *   3. Busca o Firebase Auth user pelo email do user.
 *   4. Atualiza owner_firebase_uid (e destinatario_firebase_uid em notif).
 *
 * Uso:
 *   # DRY-RUN (sem escrever — recomendado primeiro)
 *   cd scripts
 *   node migrateOwnerFirebaseUid.js
 *
 *   # APLICAR de verdade
 *   node migrateOwnerFirebaseUid.js --apply
 *
 * Pre-requisitos:
 *   - scripts/serviceAccountKey.json (download em Firebase Console > Project
 *     Settings > Service Accounts > Generate new private key)
 *   - npm install dentro de scripts/ (firebase-admin ja esta no package.json)
 */

const admin = require("firebase-admin");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;

admin.initializeApp({
  credential: admin.credential.cert(require("./serviceAccountKey.json")),
});

const db = admin.firestore();
const auth = admin.auth();

// Cache email -> Firebase Auth UID para nao buscar a mesma conta repetidamente
const emailToFirebaseUid = new Map();

async function getFirebaseUidByEmail(email) {
  if (!email) return null;
  const cached = emailToFirebaseUid.get(email);
  if (cached !== undefined) return cached;

  try {
    const user = await auth.getUserByEmail(email);
    emailToFirebaseUid.set(email, user.uid);
    return user.uid;
  } catch (err) {
    if (err.code === "auth/user-not-found") {
      console.warn(`  [skip] Firebase Auth user nao existe para email: ${email}`);
    } else {
      console.warn(`  [skip] erro ao buscar Auth user para ${email}: ${err.message}`);
    }
    emailToFirebaseUid.set(email, null);
    return null;
  }
}

// Cache owner_uid (u_xxx) -> { email, fbUid }
const ownerUidToProfile = new Map();

async function resolveOwnerProfile(ownerUid) {
  if (!ownerUid) return null;
  const cached = ownerUidToProfile.get(ownerUid);
  if (cached !== undefined) return cached;

  try {
    const userDoc = await db.collection("usuarios").doc(ownerUid).get();
    if (!userDoc.exists) {
      ownerUidToProfile.set(ownerUid, null);
      return null;
    }
    const u = userDoc.data();
    const email = u.email || "";
    const fbUid = await getFirebaseUidByEmail(email);
    const profile = { email, fbUid, nome: u.nome || "" };
    ownerUidToProfile.set(ownerUid, profile);
    return profile;
  } catch (err) {
    console.warn(`  [skip] erro ao ler usuarios/${ownerUid}: ${err.message}`);
    ownerUidToProfile.set(ownerUid, null);
    return null;
  }
}

async function migrateCollection(collectionName, fieldsToFix = ["owner_firebase_uid"]) {
  console.log(`\n=== ${collectionName} ===`);
  let scanned = 0;
  let candidates = 0;
  let migrated = 0;
  let skipped = 0;

  const snapshot = await db.collection(collectionName).get();

  for (const doc of snapshot.docs) {
    scanned++;
    const data = doc.data();
    const currentFbUid = data.owner_firebase_uid;
    const needsFix = !currentFbUid || currentFbUid === "" || currentFbUid === null;
    if (!needsFix) continue;

    candidates++;
    const ownerUid = data.owner_uid || "";
    if (!ownerUid) {
      console.log(`  [skip] ${doc.id}: sem owner_uid`);
      skipped++;
      continue;
    }

    const profile = await resolveOwnerProfile(ownerUid);
    if (!profile || !profile.fbUid) {
      console.log(`  [skip] ${doc.id}: nao foi possivel resolver owner_uid ${ownerUid}`);
      skipped++;
      continue;
    }

    const updates = {};
    for (const field of fieldsToFix) {
      updates[field] = profile.fbUid;
    }
    updates.updated_at = admin.firestore.FieldValue.serverTimestamp();
    updates.migratedAt_C12 = admin.firestore.FieldValue.serverTimestamp();

    console.log(
      `  [${DRY_RUN ? "DRY" : "APPLY"}] ${doc.id}: ` +
      `owner_uid=${ownerUid} (${profile.email}) -> fb=${profile.fbUid}`
    );

    if (APPLY) {
      try {
        await doc.ref.update(updates);
        migrated++;
      } catch (err) {
        console.error(`  [error] ${doc.id}: ${err.message}`);
        skipped++;
      }
    } else {
      migrated++; // contagem em dry-run
    }
  }

  console.log(
    `  Resumo ${collectionName}: scanned=${scanned}, ` +
    `candidates=${candidates}, ${APPLY ? "migrated" : "would_migrate"}=${migrated}, skipped=${skipped}`
  );
  return { scanned, candidates, migrated, skipped };
}

async function migrateNotificacoes() {
  console.log(`\n=== notificacoes (destinatario_firebase_uid) ===`);
  let scanned = 0;
  let candidates = 0;
  let migrated = 0;
  let skipped = 0;

  const snapshot = await db.collection("notificacoes").get();

  for (const doc of snapshot.docs) {
    scanned++;
    const data = doc.data();
    const currentFbUid = data.destinatario_firebase_uid;
    const needsFix = !currentFbUid || currentFbUid === "";
    if (!needsFix) continue;

    candidates++;
    const destUid = data.destinatario_uid || "";
    if (!destUid) {
      skipped++;
      continue;
    }

    const profile = await resolveOwnerProfile(destUid);
    if (!profile || !profile.fbUid) {
      skipped++;
      continue;
    }

    const updates = {
      destinatario_firebase_uid: profile.fbUid,
      migratedAt_C12: admin.firestore.FieldValue.serverTimestamp(),
    };

    console.log(
      `  [${DRY_RUN ? "DRY" : "APPLY"}] notif ${doc.id}: ` +
      `dest_uid=${destUid} -> fb=${profile.fbUid}`
    );

    if (APPLY) {
      try {
        await doc.ref.update(updates);
        migrated++;
      } catch (err) {
        console.error(`  [error] notif ${doc.id}: ${err.message}`);
        skipped++;
      }
    } else {
      migrated++;
    }
  }

  console.log(
    `  Resumo notificacoes: scanned=${scanned}, ` +
    `candidates=${candidates}, ${APPLY ? "migrated" : "would_migrate"}=${migrated}, skipped=${skipped}`
  );
  return { scanned, candidates, migrated, skipped };
}

async function run() {
  console.log("==========================================");
  console.log(" Migracao C12: owner_firebase_uid vazio");
  console.log("==========================================");
  console.log(` Modo: ${APPLY ? "APLICAR (escreve no Firestore)" : "DRY-RUN (apenas lista)"}`);
  console.log("");

  const results = {};
  results.pets_perdidos = await migrateCollection("pets_perdidos");
  results.avistamentos = await migrateCollection("avistamentos");
  results.alert_privado = await migrateCollection("alert_privado");
  results.notificacoes = await migrateNotificacoes();

  console.log("\n==========================================");
  console.log(" RESUMO FINAL");
  console.log("==========================================");
  for (const [name, r] of Object.entries(results)) {
    console.log(`  ${name}: ${r.migrated}/${r.candidates} migrados (skipped=${r.skipped})`);
  }

  if (DRY_RUN) {
    console.log("\nEra dry-run. Para aplicar de verdade:");
    console.log("  node migrateOwnerFirebaseUid.js --apply");
  } else {
    console.log("\nMigracao aplicada. Verifique manualmente alguns docs no Firestore Console.");
  }

  process.exit(0);
}

run().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
