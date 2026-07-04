#!/usr/bin/env node
/**
 * Migração P0 (custo) — tirar o base64 grande (`foto_comprimida`, ≤120KB) dos
 * documentos PÚBLICOS (`pets_perdidos`, `avistamentos`) e deixar no doc apenas
 * um thumbnail leve (`foto_thumb`, ~10KB, 200px/jpeg q50).
 *
 * Racional: o feed abre listeners de até 200 docs por coleção; com o base64 no
 * doc, cada abertura de feed custa dezenas de MB de egress (cota grátis:
 * 10GiB/mês). A imagem cheia já vive no Storage (`imageStorageUrl`) — o app
 * renderiza o detalhe a partir dela e o feed a partir do `foto_thumb`.
 *
 * O que o script faz, por doc:
 *   1) Se não tem `foto_thumb` e tem `foto_comprimida` → gera o thumbnail a
 *      partir do próprio base64 (sharp) e grava `foto_thumb`.
 *   2) Se tem `imageStorageUrl` E (`foto_thumb` ou thumb gerado no passo 1)
 *      → zera `foto_comprimida` (a imagem cheia fica só no Storage).
 *   Docs sem `imageStorageUrl` MANTÊM o base64 (é a única cópia da foto).
 *
 * Características: idempotente, DRY-RUN por padrão.
 *
 * Dependência extra: sharp (não versionada no app):
 *   npm install sharp --no-save
 *
 * Uso:
 *   export GOOGLE_APPLICATION_CREDENTIALS="./serviceAccountKey.json"
 *   node scripts/migrate-p0-foto-thumb.js            # dry-run
 *   node scripts/migrate-p0-foto-thumb.js --apply
 */

'use strict';

const path = require('path');
const admin = require('firebase-admin');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

const PUBLIC_COLLECTIONS = ['pets_perdidos', 'avistamentos'];
const THUMB_SIZE = 200;
const THUMB_QUALITY = 50;

let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.error('\n[ERRO] Dependência "sharp" não encontrada.');
  console.error('Instale com:  npm install sharp --no-save');
  process.exit(1);
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

async function makeThumbDataUrl(base64DataUrl) {
  const comma = base64DataUrl.indexOf('base64,');
  if (comma === -1) return '';
  const buf = Buffer.from(base64DataUrl.slice(comma + 7), 'base64');
  const out = await sharp(buf)
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMB_QUALITY })
    .toBuffer();
  return `data:image/jpeg;base64,${out.toString('base64')}`;
}

async function migrateCollection(db, collection) {
  let scanned = 0;
  let thumbGenerated = 0;
  let base64Stripped = 0;
  let keptAsOnlyCopy = 0;
  let alreadyOk = 0;
  let failed = 0;

  const snap = await db.collection(collection).get();
  for (const doc of snap.docs) {
    scanned++;
    const data = doc.data();
    const hasBase64 = typeof data.foto_comprimida === 'string' && data.foto_comprimida.length > 0;
    const hasThumb = typeof data.foto_thumb === 'string' && data.foto_thumb.length > 0;
    const hasStorage = typeof data.imageStorageUrl === 'string' && data.imageStorageUrl.length > 0;

    if (!hasBase64 && hasThumb) { alreadyOk++; continue; }
    if (!hasBase64 && !hasThumb) { alreadyOk++; continue; } // sem foto — nada a fazer

    const updates = {};
    let thumb = data.foto_thumb || '';

    if (!hasThumb) {
      try {
        thumb = await makeThumbDataUrl(data.foto_comprimida);
        if (thumb) { updates.foto_thumb = thumb; thumbGenerated++; }
      } catch (e) {
        failed++;
        console.warn(`  [${collection}/${doc.id}] falha ao gerar thumb: ${e.message}`);
        continue;
      }
    }

    if (hasStorage && thumb) {
      updates.foto_comprimida = '';
      base64Stripped++;
    } else if (!hasStorage) {
      keptAsOnlyCopy++;
    }

    if (Object.keys(updates).length === 0) { alreadyOk++; continue; }

    if (APPLY) {
      await doc.ref.update(updates);
    }
  }

  console.log(`\n[${collection}] escaneados=${scanned} thumbsGerados=${thumbGenerated} ` +
    `base64Removidos=${base64Stripped} mantidosSemStorage=${keptAsOnlyCopy} ok=${alreadyOk} falhas=${failed}`);
}

(async () => {
  console.log(`\n=== Migração P0 foto_thumb (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
  if (!APPLY) console.log('Nenhuma escrita será feita. Use --apply para aplicar.\n');
  initAdmin();
  const db = admin.firestore();
  for (const c of PUBLIC_COLLECTIONS) {
    await migrateCollection(db, c);
  }
  console.log('\nConcluído.');
  process.exit(0);
})().catch((e) => {
  console.error('\n[ERRO FATAL]', e);
  process.exit(1);
});
