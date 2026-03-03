const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.cert(require("./serviceAccountKey.json")),
});

const db = admin.firestore();

async function run() {
  const email = process.argv[2];
  if (!email) {
    console.log("Use: node makeAdmin.js email@dominio.com");
    process.exit(1);
  }

  // Buscar usuário na coleção 'usuarios' do Firestore por email
  const snapshot = await db.collection("usuarios")
    .where("email", "==", email)
    .limit(1)
    .get();

  if (snapshot.empty) {
    console.error(`❌ Nenhum usuário encontrado com email: ${email}`);
    console.log("Certifique-se de que já fez login no app com esse email.");
    process.exit(1);
  }

  const userDoc = snapshot.docs[0];
  const userData = userDoc.data();

  // Definir role: admin no documento do Firestore
  await db.collection("usuarios").doc(userDoc.id).update({
    role: "admin",
    updated_at: admin.firestore.FieldValue.serverTimestamp()
  });

  console.log("✅ Admin definido com sucesso!");
  console.log("UID:", userDoc.id);
  console.log("Nome:", userData.nome || userData.name || "(sem nome)");
  console.log("Email:", userData.email);
  console.log("Role: admin");
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Erro:", err.message);
  process.exit(1);
});
