/**
 * Testes do Firestore Rules emulator — Encontre Pet
 * Codifica a "Matriz de Acesso Esperada" do AUDIT.md como gabarito executável.
 *
 * Rode via:  firebase emulators:exec --only firestore "npm --prefix test/rules test"
 * (a partir da raiz do repo). O emulator lê firestore.rules de firebase.json.
 *
 * Convenções:
 *  - request.auth.uid = Firebase Auth UID. Ownership de docs públicos casa via
 *    owner_firebase_uid == request.auth.uid (owner_uid u_xxx NUNCA casa — S-08).
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, limit,
} = require('firebase/firestore');

const PROJECT_ID = 'encontrepet-rules-test';
const RULES = fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8');

// Firebase Auth UIDs (o que request.auth.uid vê)
const OWNER = 'fbuid_owner';
const OTHER = 'fbuid_other';
const ADMIN = 'fbuid_admin';

let testEnv;

// Helper: semeia docs ignorando as rules
async function seed(fn) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore());
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: RULES,
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Admin conhecido (documento em admin_roles/{firebaseUid})
  await seed(async (db) => {
    await setDoc(doc(db, 'admin_roles', ADMIN), { email: 'admin@x.com' });
  });
});

// Contextos
const anon = () => testEnv.unauthenticatedContext().firestore();
const asOwner = () => testEnv.authenticatedContext(OWNER).firestore();
const asOther = () => testEnv.authenticatedContext(OTHER).firestore();
const asAdmin = () => testEnv.authenticatedContext(ADMIN).firestore();

const petPublic = (extra = {}) => ({
  tipo_animal: 'cao',
  nome_pet: 'Rex',
  status: 'ativo',
  owner_uid: 'u_owner_custom',
  owner_firebase_uid: OWNER,
  ...extra,
});

describe('pets_perdidos (público)', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'pets_perdidos', 'p1'), petPublic());
    });
  });

  it('leitura pública liberada (anônimo)', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'pets_perdidos', 'p1')));
  });

  it('dono cria seu alerta', async () => {
    await assertSucceeds(setDoc(doc(asOwner(), 'pets_perdidos', 'p2'), petPublic()));
  });

  it('terceiro NÃO cria alerta com owner_firebase_uid alheio', async () => {
    await assertFails(setDoc(doc(asOther(), 'pets_perdidos', 'p3'), petPublic()));
  });

  it('create com campo de hash é bloqueado (só CF/admin gera hash)', async () => {
    await assertFails(setDoc(doc(asOwner(), 'pets_perdidos', 'p4'), petPublic({ imageHash: 'abc' })));
  });

  it('dono atualiza seu alerta', async () => {
    await assertSucceeds(updateDoc(doc(asOwner(), 'pets_perdidos', 'p1'), { descricao: 'nova' }));
  });

  it('terceiro NÃO atualiza alerta alheio', async () => {
    await assertFails(updateDoc(doc(asOther(), 'pets_perdidos', 'p1'), { descricao: 'hack' }));
  });

  it('admin atualiza qualquer alerta', async () => {
    await assertSucceeds(updateDoc(doc(asAdmin(), 'pets_perdidos', 'p1'), { descricao: 'mod' }));
  });

  it('terceiro NÃO deleta alerta alheio', async () => {
    await assertFails(deleteDoc(doc(asOther(), 'pets_perdidos', 'p1')));
  });
});

describe('alert_privado (LGPD)', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'alert_privado', 'pets_perdidos_p1'), {
        owner_firebase_uid: OWNER,
        owner_uid: 'u_owner_custom',
        contato_telefone: '11999998888',
        contato_email: 'owner@x.com',
      });
    });
  });

  it('dono lê seus dados privados', async () => {
    await assertSucceeds(getDoc(doc(asOwner(), 'alert_privado', 'pets_perdidos_p1')));
  });

  it('terceiro autenticado NÃO lê dados privados (S-01)', async () => {
    await assertFails(getDoc(doc(asOther(), 'alert_privado', 'pets_perdidos_p1')));
  });

  it('anônimo NÃO lê dados privados (S-01)', async () => {
    await assertFails(getDoc(doc(anon(), 'alert_privado', 'pets_perdidos_p1')));
  });

  it('list é sempre negado', async () => {
    await assertFails(getDocs(collection(asOwner(), 'alert_privado')));
  });
});

describe('notificacoes (S-02)', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'notificacoes', 'n1'), {
        destinatario_firebase_uid: OWNER,
        destinatario_uid: 'u_owner_custom',
        tipo: 'match_ia',
        lida: false,
      });
    });
  });

  it('destinatário lê sua notificação', async () => {
    await assertSucceeds(getDoc(doc(asOwner(), 'notificacoes', 'n1')));
  });

  it('terceiro NÃO lê notificação alheia (S-02)', async () => {
    await assertFails(getDoc(doc(asOther(), 'notificacoes', 'n1')));
  });

  it('qualquer autenticado pode CRIAR notificação (sistema)', async () => {
    await assertSucceeds(setDoc(doc(asOther(), 'notificacoes', 'n2'), {
      destinatario_firebase_uid: OWNER,
      destinatario_uid: 'u_owner_custom',
      tipo: 'match_ia',
      lida: false,
    }));
  });

  it('destinatário marca como lida (update)', async () => {
    await assertSucceeds(updateDoc(doc(asOwner(), 'notificacoes', 'n1'), { lida: true }));
  });

  it('terceiro NÃO altera notificação alheia', async () => {
    await assertFails(updateDoc(doc(asOther(), 'notificacoes', 'n1'), { lida: true }));
  });
});

describe('usuarios / senhas_usuarios (S-03)', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'usuarios', OWNER), { email: 'owner@x.com', role: 'user', status: 'ativo' });
      await setDoc(doc(db, 'senhas_usuarios', OWNER), { senha_hash: 'deadbeef' });
    });
  });

  it('get do próprio usuário (por UID) permitido', async () => {
    await assertSucceeds(getDoc(doc(asOwner(), 'usuarios', OWNER)));
  });

  it('list com limit <= 200 permitido (findByEmail)', async () => {
    await assertSucceeds(getDocs(query(collection(asOther(), 'usuarios'), limit(200))));
  });

  it('senhas_usuarios: leitura sempre negada (S-03)', async () => {
    await assertFails(getDoc(doc(asOwner(), 'senhas_usuarios', OWNER)));
  });

  it('senhas_usuarios: escrita sempre negada (S-03)', async () => {
    await assertFails(setDoc(doc(asOwner(), 'senhas_usuarios', OWNER), { senha_hash: 'x' }));
  });

  it('usuário NÃO pode elevar o próprio role (campo protegido)', async () => {
    await assertFails(updateDoc(doc(asOwner(), 'usuarios', OWNER), { role: 'admin' }));
  });
});

describe('lgpd_access_log', () => {
  it('autenticado pode criar log', async () => {
    await assertSucceeds(setDoc(doc(asOther(), 'lgpd_access_log', 'l1'), { tipo: 'x', ts: 1 }));
  });

  it('leitura de log é negada a clientes', async () => {
    await seed(async (db) => setDoc(doc(db, 'lgpd_access_log', 'l2'), { tipo: 'x' }));
    await assertFails(getDoc(doc(asOwner(), 'lgpd_access_log', 'l2')));
  });
});

describe('conversas (chat interno)', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'conversas', 'c1'), {
        participantes_firebase_uids: [OWNER, OTHER],
        lastMessage: 'oi',
      });
    });
  });

  it('participante lê a conversa', async () => {
    await assertSucceeds(getDoc(doc(asOwner(), 'conversas', 'c1')));
  });

  it('não-participante NÃO lê a conversa', async () => {
    await assertFails(getDoc(doc(asAdmin(), 'conversas', 'c1')));
  });

  it('cliente NÃO cria conversa (só Cloud Function)', async () => {
    await assertFails(setDoc(doc(asOwner(), 'conversas', 'c2'), {
      participantes_firebase_uids: [OWNER, OTHER],
    }));
  });
});

describe('confirmação bilateral de reunião (canConfirmReunion)', () => {
  // OTHER é a contraparte (avistador designado); OWNER é o tutor.
  const reuniaoBase = {
    avistador_firebase_uid: OTHER,
    avistador_uid: 'u_other',
    marcado_por_firebase_uid: OWNER,
    marcado_em: '2026-07-02T00:00:00Z',
    confirmado_por_firebase_uid: '',
    confirmacao_unilateral: false,
  };

  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'pets_perdidos', 'pr'), petPublic({
        status: 'aguardando_confirmacao',
        reuniao: reuniaoBase,
      }));
    });
  });

  const confirmPayload = (extra = {}) => ({
    status: 'encontrado',
    desfecho: 'reuniao_confirmada',
    data_encerrado: '2026-07-03T00:00:00Z',
    reuniao: { ...reuniaoBase, confirmado_por_firebase_uid: OTHER, confirmado_em: '2026-07-03T00:00:00Z' },
    ...extra,
  });

  it('contraparte designada confirma o reencontro', async () => {
    await assertSucceeds(updateDoc(doc(asOther(), 'pets_perdidos', 'pr'), confirmPayload()));
  });

  it('terceiro (não designado, sem privilégio) NÃO confirma', async () => {
    const stranger = testEnv.authenticatedContext('fbuid_stranger').firestore();
    await assertFails(updateDoc(doc(stranger, 'pets_perdidos', 'pr'), confirmPayload()));
  });

  it('contraparte NÃO pode alterar campos além do encerramento', async () => {
    await assertFails(updateDoc(doc(asOther(), 'pets_perdidos', 'pr'), confirmPayload({ nome_pet: 'Hackeado' })));
  });

  it('confirmação bloqueada se o pet não está aguardando_confirmacao', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'pets_perdidos', 'pr2'), petPublic({ status: 'ativo', reuniao: reuniaoBase }));
    });
    await assertFails(updateDoc(doc(asOther(), 'pets_perdidos', 'pr2'), confirmPayload()));
  });

  it('tutor ainda pode marcar aguardando_confirmacao (não regressão de update do dono)', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'pets_perdidos', 'pr3'), petPublic({ status: 'ativo' }));
    });
    await assertSucceeds(updateDoc(doc(asOwner(), 'pets_perdidos', 'pr3'), {
      status: 'aguardando_confirmacao',
      reuniao: reuniaoBase,
    }));
  });
});

describe('fallback global', () => {
  it('coleção desconhecida é negada', async () => {
    await assertFails(getDoc(doc(asOwner(), 'coisa_aleatoria', 'x')));
    await assertFails(setDoc(doc(asOwner(), 'coisa_aleatoria', 'x'), { a: 1 }));
  });
});
