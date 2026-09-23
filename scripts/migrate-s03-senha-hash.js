#!/usr/bin/env node
/**
 * Migração S-03 — remover `senha_hash` (e `senha_salt`) dos documentos públicos
 * da coleção `usuarios`, movendo-os para a coleção protegida `senhas_usuarios/{uid}`
 * (regra `allow read, write: if false` — só Admin SDK acessa).
 *
 * Contexto: AUDIT.md S-03. As Cloud Functions `saveUserPassword`/`verifyUserPassword`
 * já operam sobre `senhas_usuarios`. Este script limpa docs LEGADOS criados antes
 * dessa mudança, que ainda possam conter o hash no doc público de usuário.
 *
 * Características:
 *   - IDEMPOTENTE: rodar várias vezes é seguro; só age em docs que ainda têm o campo.
 *   - DRY-RUN por padrão: não escreve nada sem `--apply`.
 *   - Preserva o hash: copia para `senhas_usuarios/{uid}` ANTES de remover do público.
 *
 * Uso:
 *   # Pré-requisito: ter o serviceAccountKey.json local (NÃO COMMITAR — já está no .gitignore)
 *   export GOOGLE_APPLICATION_CREDENTIALS="./serviceAccountKey.json"
 *   node scripts/migrate-s03-senha-hash.js            # dry-run (apenas relatório)
 *   node scripts/migrate-s03-senha-hash.js --apply    # executa de fato
 *
 * Alternativa (sem env var): coloque serviceAccountKey.json na raiz e rode normalmente.
 */

'use strict';

const path = require('path');
const admin = require('firebase-admin');

const APPLY = process.argv.includes('--apply');
const SENSITIVE_FIELDS = ['senha_hash', 'senha_salt', 'password_hash', 'passwordHash'];

function initAdmin() {
  if (admin.apps.length) return;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return;
  }
  // Fallback: serviceAccountKey.json na raiz do projeto
  try {
    const svc = require(path.resolve(process.cwd(), 'serviceAccountKey.json'));
    admin.initializeApp({ credential: admin.credential.cert(svc) });
  } catch (e) {
    console.error('\n[ERRO] Credencial não encontrada.');
    console.error('Defina GOOGLE_APPLICATION_CREDENTIALS ou coloque serviceAccountKey.json na raiz.');
    process.exit(1);
  }
}

async function run() {
  initAdmin();
  const db = admin.firestore();

  console.log(`\n=== Migração S-03 (senha_hash) — modo: ${APPLY ? 'APPLY (escrita real)' : 'DRY-RUN'} ===\n`);

  const snap = await db.collection('usuarios').get();
  let scanned = 0;
  let affected = 0;
  let movedToProtected = 0;
  let skippedNoUid = 0;

  for (const doc of snap.docs) {
    scanned++;
    const data = doc.data() || {};
    const present = SENSITIVE_FIELDS.filter((f) => data[f] !== undefined && data[f] !== null && data[f] !== '');
    if (present.length === 0) continue; // já limpo — idempotente

    affected++;
    const uid = doc.id;
    console.log(`- usuarios/${uid}: campos sensíveis presentes -> ${present.join(', ')}`);

    if (!APPLY) continue;

    // 1) Garantir cópia em senhas_usuarios/{uid} (merge, sem sobrescrever um hash já existente)
    const protectedRef = db.collection('senhas_usuarios').doc(uid);
    const protectedSnap = await protectedRef.get();
    const hash = data.senha_hash || data.password_hash || data.passwordHash || '';
    const salt = data.senha_salt || '';
    if (!protectedSnap.exists || !(protectedSnap.data() || {}).senha_hash) {
      if (hash) {
        await protectedRef.set(
          {
            senha_hash: hash,
            ...(salt ? { senha_salt: salt } : {}),
            migrado_de: 'usuarios',
            migrado_em: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        movedToProtected++;
      } else {
        skippedNoUid++;
      }
    }

    // 2) Remover os campos sensíveis do doc público
    const updates = {};
    for (const f of present) updates[f] = admin.firestore.FieldValue.delete();
    await doc.ref.update(updates);
  }

  console.log('\n=== Resumo ===');
  console.log(`Documentos lidos:           ${scanned}`);
  console.log(`Com campo sensível:         ${affected}`);
  if (APPLY) {
    console.log(`Hashes copiados p/ protegida:${movedToProtected}`);
    console.log(`Sem hash p/ copiar:         ${skippedNoUid}`);
    console.log('\n✅ Migração aplicada.');
  } else {
    console.log('\nℹ️  DRY-RUN — nada foi escrito. Rode com --apply para executar.');
  }
}

run().catch((err) => {
  console.error('\n[FALHA] Migração abortada:', err);
  process.exit(1);
});
