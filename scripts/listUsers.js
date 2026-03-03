const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.cert(require("./serviceAccountKey.json")),
});

async function run() {
  const result = await admin.auth().listUsers(100);
  console.log("Usuários cadastrados no Firebase Auth:\n");
  result.users.forEach((u, i) => {
    console.log(`${i + 1}. UID: ${u.uid}`);
    console.log(`   Email: ${u.email || "(sem email)"}`);
    console.log(`   Provider: ${u.providerData.map(p => p.providerId).join(", ") || "anonymous"}`);
    console.log(`   Criado: ${u.metadata.creationTime}`);
    console.log("");
  });
  console.log(`Total: ${result.users.length} usuários`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Erro:", err.message);
  process.exit(1);
});
