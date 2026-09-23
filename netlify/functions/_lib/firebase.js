// _lib/firebase.js — inicialização do firebase-admin para Netlify Functions.
// Credencial (ordem de resolução):
//   1. FIREBASE_SERVICE_ACCOUNT      — JSON puro ou base64 (produção: painel Netlify)
//   2. FIREBASE_SERVICE_ACCOUNT_FILE — caminho do arquivo (dev local via .env;
//      o .env guarda só o caminho — nenhum segredo sai do serviceAccountKey.json)
// NUNCA commitar a service account no repo (regra do projeto).

const admin = require('firebase-admin');

function parseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (raw) {
    const jsonStr = raw.trim().startsWith('{')
      ? raw
      : Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(jsonStr);
  }

  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_FILE || '';
  if (filePath) {
    const fs = require('node:fs');
    const path = require('node:path');
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  }

  throw new Error(
    'Credencial ausente. Produção: FIREBASE_SERVICE_ACCOUNT no painel Netlify ' +
    '(JSON ou base64). Dev local: FIREBASE_SERVICE_ACCOUNT_FILE no .env ' +
    'apontando para scripts/serviceAccountKey.json.'
  );
}

function getAdmin() {
  if (!admin.apps.length) {
    const serviceAccount = parseServiceAccount();
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id
    });
  }
  return admin;
}

module.exports = { getAdmin };
