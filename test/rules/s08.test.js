/**
 * PROTÓTIPO S-08 — prova de viabilidade das rules de ownership via alert_privado
 * (SEM owner_firebase_uid no doc público de pets_perdidos).
 *
 * Objetivo: comprovar que o dono mantém create/update/delete e que terceiros
 * são barrados, usando o alert_privado como fonte de ownership.
 * NÃO valida custo automaticamente — o custo (+2 reads por update/delete via
 * exists()+get()) está documentado nas próprias rules e no relatório.
 *
 * Rode via:  firebase emulators:exec --only firestore \
 *   "npx --prefix test/rules mocha test/rules/s08.test.js --timeout 20000"
 */

const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment, assertSucceeds, assertFails,
} = require('@firebase/rules-unit-testing');
const {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
} = require('firebase/firestore');

const PROJECT_ID = 'encontrepet-s08-proto';
const RULES = fs.readFileSync(path.resolve(__dirname, 'firestore.rules.s08'), 'utf8');

const OWNER = 'fbuid_owner';
const OTHER = 'fbuid_other';

let testEnv;

async function seed(fn) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore()); });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
  });
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

const asOwner = () => testEnv.authenticatedContext(OWNER).firestore();
const asOther = () => testEnv.authenticatedContext(OTHER).firestore();

// Doc público SEM owner_firebase_uid (o objetivo do S-08)
const petPublicNoFbUid = (extra = {}) => ({
  tipo_animal: 'cao', nome_pet: 'Rex', status: 'ativo',
  owner_uid: 'u_owner_custom', ...extra,
});

describe('S-08 protótipo — ownership via alert_privado', () => {
  // O alert_privado guarda o owner_firebase_uid (fonte de ownership)
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'pets_perdidos', 'p1'), petPublicNoFbUid());
      await setDoc(doc(db, 'alert_privado', 'pets_perdidos_p1'), {
        owner_firebase_uid: OWNER, owner_uid: 'u_owner_custom',
      });
    });
  });

  it('leitura pública continua liberada', async () => {
    await assertSucceeds(getDoc(doc(asOther(), 'pets_perdidos', 'p1')));
  });

  it('dono cria alerta SEM owner_firebase_uid no público', async () => {
    await assertSucceeds(setDoc(doc(asOwner(), 'pets_perdidos', 'p2'), petPublicNoFbUid()));
  });

  it('create é REJEITADO se tentar reintroduzir owner_firebase_uid no público', async () => {
    await assertFails(setDoc(doc(asOwner(), 'pets_perdidos', 'p3'),
      petPublicNoFbUid({ owner_firebase_uid: OWNER })));
  });

  it('create é REJEITADO sem owner_uid', async () => {
    const noUid = { tipo_animal: 'cao', status: 'ativo' };
    await assertFails(setDoc(doc(asOwner(), 'pets_perdidos', 'p4'), noUid));
  });

  it('dono ATUALIZA via alert_privado (sem campo público)', async () => {
    await assertSucceeds(updateDoc(doc(asOwner(), 'pets_perdidos', 'p1'), { descricao: 'nova' }));
  });

  it('terceiro NÃO atualiza (alert_privado não bate)', async () => {
    await assertFails(updateDoc(doc(asOther(), 'pets_perdidos', 'p1'), { descricao: 'hack' }));
  });

  it('dono DELETA via alert_privado', async () => {
    await assertSucceeds(deleteDoc(doc(asOwner(), 'pets_perdidos', 'p1')));
  });

  it('terceiro NÃO deleta', async () => {
    await assertFails(deleteDoc(doc(asOther(), 'pets_perdidos', 'p1')));
  });

  it('update é bloqueado se o alert_privado não existir (sem backfill)', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'pets_perdidos', 'porphan'), petPublicNoFbUid());
      // sem alert_privado correspondente
    });
    await assertFails(updateDoc(doc(asOwner(), 'pets_perdidos', 'porphan'), { descricao: 'x' }));
  });
});
