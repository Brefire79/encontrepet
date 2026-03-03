const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp({
  credential: admin.credential.cert(require("./serviceAccountKey.json")),
});

const db = admin.firestore();

/**
 * Replica o hash SHA-256 duplo + salt usado pelo frontend (Security.createPasswordHash)
 */
async function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const data = salt + password + salt;
  const hash1 = crypto.createHash("sha256").update(data).digest();
  const hash2 = crypto.createHash("sha256").update(hash1).digest("hex");
  return salt + ":" + hash2;
}

async function run() {
  const email = process.argv[2];
  const newPassword = process.argv[3];

  if (!email || !newPassword) {
    console.log("Uso: node resetPassword.js email@dominio.com NovaSenha123");
    console.log("\nExemplo:");
    console.log("  node resetPassword.js encontrepet26@gmail.com MinhaSenhaForte!");
    process.exit(1);
  }

  if (newPassword.length < 6) {
    console.error("❌ A senha deve ter pelo menos 6 caracteres.");
    process.exit(1);
  }

  // Buscar usuário por email
  const snapshot = await db
    .collection("usuarios")
    .where("email", "==", email)
    .limit(1)
    .get();

  if (snapshot.empty) {
    console.error(`❌ Nenhum usuário encontrado com email: ${email}`);
    process.exit(1);
  }

  const userDoc = snapshot.docs[0];
  const userData = userDoc.data();

  // Gerar novo hash
  const senhaHash = await createPasswordHash(newPassword);

  // Atualizar no Firestore
  await db.collection("usuarios").doc(userDoc.id).update({
    senha_hash: senhaHash,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log("✅ Senha alterada com sucesso!");
  console.log("UID:", userDoc.id);
  console.log("Nome:", userData.nome || "(sem nome)");
  console.log("Email:", email);
  console.log("Role:", userData.role || "user");
  console.log("\n🔑 Faça login no app com a nova senha.");
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Erro:", err.message);
  process.exit(1);
});
