/**
 * Reset de usuários — remove TODOS os usuários do Firebase Auth e Firestore
 * EXCETO encontrepet26@gmail.com (admin) e breno.luis@gmail.com (user).
 * Também limpa dados (pets_perdidos, avistamentos, alert_privado, notificacoes).
 *
 * Uso: node resetUsers.js
 */
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require("./serviceAccountKey.json")),
  });
}

const db = admin.firestore();

const KEEP_EMAILS = [
  "encontrepet26@gmail.com",
  "breno.luis@gmail.com"
];

async function run() {
  console.log("=== RESET DE USUÁRIOS ===\n");

  // ── 1. Listar todos do Firebase Auth ──
  const authResult = await admin.auth().listUsers(1000);
  console.log(`Firebase Auth: ${authResult.users.length} contas total`);

  const keepAuthUIDs = new Set();
  const deleteAuthUsers = [];

  for (const u of authResult.users) {
    const email = (u.email || "").toLowerCase();
    if (KEEP_EMAILS.includes(email)) {
      keepAuthUIDs.add(u.uid);
      console.log(`  ✅ MANTER Auth: ${u.uid} (${email})`);
    } else {
      deleteAuthUsers.push(u);
      console.log(`  🗑️  DELETAR Auth: ${u.uid} (${email || "anonymous"})`);
    }
  }

  // ── 2. Listar todos do Firestore /usuarios ──
  const usersSnap = await db.collection("usuarios").get();
  console.log(`\nFirestore /usuarios: ${usersSnap.size} docs total`);

  const keepFirestoreIDs = new Set();
  const deleteFirestoreDocs = [];

  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const email = (data.email || "").toLowerCase();
    if (KEEP_EMAILS.includes(email)) {
      keepFirestoreIDs.add(doc.id);
      if (data.owner_firebase_uid) keepFirestoreIDs.add(data.owner_firebase_uid);
      console.log(`  ✅ MANTER Firestore: ${doc.id} (${email})`);
    } else {
      deleteFirestoreDocs.push(doc);
      console.log(`  🗑️  DELETAR Firestore: ${doc.id} (${email || "sem email"})`);
    }
  }

  // Juntar todos os UIDs preservados
  const allKeepUIDs = new Set([...keepAuthUIDs, ...keepFirestoreIDs]);

  // ── 3. Deletar contas Firebase Auth ──
  console.log(`\n--- Deletando ${deleteAuthUsers.length} contas do Auth ---`);
  for (const u of deleteAuthUsers) {
    try {
      await admin.auth().deleteUser(u.uid);
      console.log(`  ✓ Auth deletado: ${u.uid}`);
    } catch (e) {
      console.error(`  ✗ Erro ao deletar Auth ${u.uid}: ${e.message}`);
    }
  }

  // ── 4. Deletar docs /usuarios ──
  console.log(`\n--- Deletando ${deleteFirestoreDocs.length} docs de /usuarios ---`);
  for (const doc of deleteFirestoreDocs) {
    await doc.ref.delete();
    console.log(`  ✓ Firestore /usuarios deletado: ${doc.id}`);
  }

  // ── 5. Limpar collections de dados (manter só docs dos preservados) ──
  const collections = ["pets_perdidos", "avistamentos", "alert_privado", "notificacoes"];
  for (const col of collections) {
    const snap = await db.collection(col).get();
    let deleted = 0, kept = 0;
    for (const doc of snap.docs) {
      const d = doc.data();
      const ownerUid = d.owner_uid || "";
      const ownerFbUid = d.owner_firebase_uid || "";
      const isKept = allKeepUIDs.has(ownerUid) || allKeepUIDs.has(ownerFbUid);
      if (isKept) {
        kept++;
      } else {
        await doc.ref.delete();
        deleted++;
      }
    }
    console.log(`\n  ${col}: ${deleted} deletados, ${kept} mantidos`);
  }

  // ── 6. Garantir admin no encontrepet26 ──
  const adminSnap = await db.collection("usuarios")
    .where("email", "==", "encontrepet26@gmail.com")
    .limit(1)
    .get();

  if (!adminSnap.empty) {
    const adminDoc = adminSnap.docs[0];
    await adminDoc.ref.update({ role: "admin" });
    console.log(`\n✅ encontrepet26@gmail.com → role: admin`);
  }

  // Garantir que breno.luis NÃO é admin
  const brenoSnap = await db.collection("usuarios")
    .where("email", "==", "breno.luis@gmail.com")
    .limit(1)
    .get();

  if (!brenoSnap.empty) {
    const brenoDoc = brenoSnap.docs[0];
    const brenoData = brenoDoc.data();
    if (brenoData.role === "admin") {
      await brenoDoc.ref.update({ role: "user" });
      console.log(`✅ breno.luis@gmail.com → role: user`);
    } else {
      console.log(`✅ breno.luis@gmail.com → role: ${brenoData.role || "user"} (ok)`);
    }
  }

  console.log("\n=== RESET CONCLUÍDO ===");
  process.exit(0);
}

run().catch(err => {
  console.error("❌ Erro:", err.message);
  process.exit(1);
});
