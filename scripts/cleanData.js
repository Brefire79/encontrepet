/**
 * cleanData.js — Limpa TODOS os pets, avistamentos, notificações e dados privados.
 * Mantém as contas de usuário (collection usuarios) intactas.
 * 
 * Uso: node cleanData.js
 *   --force  para pular a confirmação
 */
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require("./serviceAccountKey.json")),
  });
}

const db = admin.firestore();

const COLLECTIONS_TO_CLEAN = [
  "pets_perdidos",
  "avistamentos",
  "notificacoes",
  "alert_privado",
];

async function deleteCollection(collectionName) {
  const snapshot = await db.collection(collectionName).get();
  if (snapshot.empty) {
    console.log(`  ✅ ${collectionName}: vazia (0 docs)`);
    return 0;
  }

  // Firestore batch supports max 500 ops
  const batchSize = 500;
  let deleted = 0;
  const docs = snapshot.docs;

  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + batchSize);
    chunk.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += chunk.length;
  }

  console.log(`  🗑️  ${collectionName}: ${deleted} docs removidos`);
  return deleted;
}

async function run() {
  console.log("🧹 Limpeza de dados do Firestore\n");
  console.log("Coleções que serão LIMPAS:", COLLECTIONS_TO_CLEAN.join(", "));
  console.log("Coleções PRESERVADAS: usuarios\n");

  // Listar contagem antes
  for (const col of COLLECTIONS_TO_CLEAN) {
    const snap = await db.collection(col).get();
    console.log(`  📂 ${col}: ${snap.size} docs`);
  }

  if (!process.argv.includes("--force")) {
    console.log("\n⚠️  Isso vai APAGAR TUDO das coleções acima!");
    console.log("Use --force para confirmar: node cleanData.js --force\n");
    process.exit(0);
  }

  console.log("\n🔥 Executando limpeza...\n");
  let totalDeleted = 0;

  for (const col of COLLECTIONS_TO_CLEAN) {
    try {
      totalDeleted += await deleteCollection(col);
    } catch (err) {
      console.error(`  ❌ Erro em ${col}:`, err.message);
    }
  }

  console.log(`\n✅ Limpeza concluída! ${totalDeleted} documentos removidos.`);
  console.log("📌 Contas de usuário foram mantidas.");
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Erro fatal:", err.message);
  process.exit(1);
});
