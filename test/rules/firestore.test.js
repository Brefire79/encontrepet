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

  it('autenticado cria notificação com tipo permitido (sistema)', async () => {
    await assertSucceeds(setDoc(doc(asOther(), 'notificacoes', 'n2'), {
      destinatario_firebase_uid: OWNER,
      destinatario_uid: 'u_owner_custom',
      tipo: 'match_ia',
      lida: false,
    }));
  });

  it('create com tipo fora da lista é negado (N-02)', async () => {
    await assertFails(setDoc(doc(asOther(), 'notificacoes', 'n3'), {
      destinatario_firebase_uid: OWNER,
      destinatario_uid: 'u_owner_custom',
      tipo: 'phishing_livre',
      lida: false,
    }));
  });

  it('create sem destinatário é negado (N-02)', async () => {
    await assertFails(setDoc(doc(asOther(), 'notificacoes', 'n4'), {
      tipo: 'match_ia',
      lida: false,
    }));
  });

  it('create com mensagem acima de 500 chars é negado (N-02)', async () => {
    await assertFails(setDoc(doc(asOther(), 'notificacoes', 'n5'), {
      destinatario_firebase_uid: OWNER,
      destinatario_uid: 'u_owner_custom',
      tipo: 'match_ia',
      mensagem: 'x'.repeat(501),
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

describe('usuarios / senhas_usuarios (S-03, N-01)', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'usuarios', OWNER), { email: 'owner@x.com', role: 'user', status: 'ativo' });
      // Doc com ID customizado u_xxx vinculado ao Firebase Auth UID do OWNER
      await setDoc(doc(db, 'usuarios', 'u_custom_1'), {
        email: 'custom@x.com', role: 'user', status: 'ativo',
        firebase_auth_uids: [OWNER],
      });
      await setDoc(doc(db, 'senhas_usuarios', OWNER), { senha_hash: 'deadbeef' });
    });
  });

  it('get do próprio usuário (por UID) permitido', async () => {
    await assertSucceeds(getDoc(doc(asOwner(), 'usuarios', OWNER)));
  });

  it('get do doc u_xxx vinculado via firebase_auth_uids permitido (N-01)', async () => {
    await assertSucceeds(getDoc(doc(asOwner(), 'usuarios', 'u_custom_1')));
  });

  it('get de doc u_xxx alheio (sem vínculo) é negado', async () => {
    await assertFails(getDoc(doc(asOther(), 'usuarios', 'u_custom_1')));
  });

  it('update do doc u_xxx vinculado permitido (sem campos protegidos)', async () => {
    await assertSucceeds(updateDoc(doc(asOwner(), 'usuarios', 'u_custom_1'), { telefone: '11999998888' }));
  });

  it('list em massa (limit 200) NEGADO para não-admin (N-01)', async () => {
    await assertFails(getDocs(query(collection(asOther(), 'usuarios'), limit(200))));
  });

  it('list com limit 1 NEGADO — fecha a enumeração um a um (N-01 final)', async () => {
    // Com limit<=1 + startAfter, um anônimo baixava a base inteira (nome,
    // e-mail, telefone). Achado na avaliação de lançamento de 2026-09-25.
    await assertFails(getDocs(query(collection(asOther(), 'usuarios'), limit(1))));
  });

  it('admin lista usuarios sem restrição', async () => {
    await assertSucceeds(getDocs(query(collection(asAdmin(), 'usuarios'), limit(200))));
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
  it('autenticado cria log em nome próprio (N-03)', async () => {
    await assertSucceeds(setDoc(doc(asOther(), 'lgpd_access_log', 'l1'), {
      tipo: 'x', ts: 1, actor_firebase_uid: OTHER,
    }));
  });

  it('create em nome de OUTRO ator é negado (N-03)', async () => {
    await assertFails(setDoc(doc(asOther(), 'lgpd_access_log', 'l1b'), {
      tipo: 'x', ts: 1, actor_firebase_uid: OWNER,
    }));
  });

  it('create sem tipo é negado (N-03)', async () => {
    await assertFails(setDoc(doc(asOther(), 'lgpd_access_log', 'l1c'), {
      ts: 1, actor_firebase_uid: OTHER,
    }));
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

describe('S-08 — ownership via alert_privado (docs sem owner_firebase_uid)', () => {
  const petSemFbUid = (extra = {}) => ({
    tipo_animal: 'cao', nome_pet: 'Rex', status: 'ativo',
    owner_uid: 'u_owner_custom', ...extra,
  });

  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'pets_perdidos', 's1'), petSemFbUid());
      await setDoc(doc(db, 'alert_privado', 'pets_perdidos_s1'), {
        owner_firebase_uid: OWNER, owner_uid: 'u_owner_custom',
      });
      await setDoc(doc(db, 'avistamentos', 'av1'), petSemFbUid());
      await setDoc(doc(db, 'alert_privado', 'avistamentos_av1'), {
        owner_firebase_uid: OWNER, owner_uid: 'u_owner_custom',
      });
    });
  });

  it('create SEM owner_firebase_uid no público é permitido', async () => {
    await assertSucceeds(setDoc(doc(asOwner(), 'pets_perdidos', 's2'), petSemFbUid()));
  });

  it('create sem owner_uid é negado', async () => {
    await assertFails(setDoc(doc(asOwner(), 'pets_perdidos', 's3'), { tipo_animal: 'cao', status: 'ativo' }));
  });

  it('create com owner_firebase_uid ALHEIO é negado (anti-spoof)', async () => {
    await assertFails(setDoc(doc(asOther(), 'pets_perdidos', 's4'),
      petSemFbUid({ owner_firebase_uid: OWNER })));
  });

  it('dono ATUALIZA pet stripado via alert_privado', async () => {
    await assertSucceeds(updateDoc(doc(asOwner(), 'pets_perdidos', 's1'), { descricao: 'nova' }));
  });

  it('terceiro NÃO atualiza pet stripado', async () => {
    await assertFails(updateDoc(doc(asOther(), 'pets_perdidos', 's1'), { descricao: 'hack' }));
  });

  it('dono DELETA pet stripado via alert_privado', async () => {
    await assertSucceeds(deleteDoc(doc(asOwner(), 'pets_perdidos', 's1')));
  });

  it('dono ATUALIZA avistamento stripado via alert_privado', async () => {
    await assertSucceeds(updateDoc(doc(asOwner(), 'avistamentos', 'av1'), { descricao: 'nova' }));
  });

  it('terceiro NÃO deleta avistamento stripado', async () => {
    await assertFails(deleteDoc(doc(asOther(), 'avistamentos', 'av1')));
  });

  it('update de doc órfão (sem alert_privado, sem campo público) é negado', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'pets_perdidos', 'sorf'), petSemFbUid());
    });
    await assertFails(updateDoc(doc(asOwner(), 'pets_perdidos', 'sorf'), { descricao: 'x' }));
  });
});

describe('S-08 leitura — vínculo avistamento↔pet só com UIDs (confirmação bilateral)', () => {
  // O tutor (OWNER) precisa do UID do avistador (OTHER) para a confirmação
  // bilateral de reunião. Ele vem de vinculos_avistamento (gravado pelo
  // backend), NUNCA do alert_privado do avistador (telefone/localização).
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'alert_privado', 'avistamentos_avlink'), {
        owner_firebase_uid: OTHER,
        owner_uid: 'u_sighter_custom',
        linked_pet_owner_firebase_uid: OWNER,
        contato_telefone: '11988887777',
      });
      await setDoc(doc(db, 'vinculos_avistamento', 'avlink'), {
        pet_id: 'pet1',
        pet_owner_firebase_uid: OWNER,
        sighter_firebase_uid: OTHER,
        sighter_owner_uid: 'u_sighter_custom',
      });
    });
  });

  it('tutor do pet vinculado NÃO lê o alert_privado do avistador (contato/LGPD)', async () => {
    await assertFails(getDoc(doc(asOwner(), 'alert_privado', 'avistamentos_avlink')));
  });

  it('avistador (dono) LÊ o próprio alert_privado', async () => {
    await assertSucceeds(getDoc(doc(asOther(), 'alert_privado', 'avistamentos_avlink')));
  });

  it('tutor LÊ o vínculo (só UIDs)', async () => {
    await assertSucceeds(getDoc(doc(asOwner(), 'vinculos_avistamento', 'avlink')));
  });

  it('avistador LÊ o vínculo', async () => {
    await assertSucceeds(getDoc(doc(asOther(), 'vinculos_avistamento', 'avlink')));
  });

  it('terceiro sem vínculo NÃO lê o vínculo', async () => {
    await assertFails(getDoc(doc(asAdmin(), 'vinculos_avistamento', 'avlink')));
  });

  it('cliente NÃO cria/forja vínculo nem lista', async () => {
    await assertFails(setDoc(doc(asOwner(), 'vinculos_avistamento', 'forjado'), {
      pet_id: 'pet1', pet_owner_firebase_uid: OWNER, sighter_firebase_uid: OWNER,
    }));
    await assertFails(getDocs(collection(asOwner(), 'vinculos_avistamento')));
  });

  it('list do alert_privado continua sempre negado', async () => {
    await assertFails(getDocs(collection(asOwner(), 'alert_privado')));
  });
});

describe('fotos — foto cheia fora do doc público (custo)', () => {
  const DATA = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'alert_privado', 'pets_perdidos_petf'), { owner_firebase_uid: OWNER });
    });
  });

  it('dono do alerta grava a foto', async () => {
    await assertSucceeds(setDoc(doc(asOwner(), 'fotos', 'pets_perdidos_petf'), { dataUrl: DATA, created_at: 'x' }));
  });

  it('terceiro NÃO grava foto em alerta alheio', async () => {
    await assertFails(setDoc(doc(asOther(), 'fotos', 'pets_perdidos_petf'), { dataUrl: DATA, created_at: 'x' }));
  });

  it('NÃO grava foto sem alert_privado correspondente', async () => {
    await assertFails(setDoc(doc(asOwner(), 'fotos', 'pets_perdidos_semprivado'), { dataUrl: DATA, created_at: 'x' }));
  });

  it('NÃO grava campos extras nem foto acima de 200KB', async () => {
    await assertFails(setDoc(doc(asOwner(), 'fotos', 'pets_perdidos_petf'), { dataUrl: DATA, created_at: 'x', extra: 1 }));
    await assertFails(setDoc(doc(asOwner(), 'fotos', 'pets_perdidos_petf'), { dataUrl: 'A'.repeat(200001), created_at: 'x' }));
  });

  it('qualquer um lê por ID, ninguém lista', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'fotos', 'pets_perdidos_petf'), { dataUrl: DATA, created_at: 'x' });
    });
    await assertSucceeds(getDoc(doc(asOther(), 'fotos', 'pets_perdidos_petf')));
    await assertFails(getDocs(collection(asOther(), 'fotos')));
  });
});

describe('push_tokens — só o backend acessa', () => {
  it('cliente NÃO grava token (nem no próprio UID)', async () => {
    await assertFails(setDoc(doc(asOwner(), 'push_tokens', 'x'), { token: 't', owner_firebase_uid: OWNER }));
  });
  it('cliente NÃO lê nem lista tokens', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'push_tokens', 'y'), { token: 't', owner_firebase_uid: OWNER });
    });
    await assertFails(getDoc(doc(asOwner(), 'push_tokens', 'y')));
    await assertFails(getDocs(collection(asOther(), 'push_tokens')));
  });
});

describe('usuarios — dono pelo e-mail exige e-mail verificado', () => {
  // Perfil legado sem vínculo (firebase_auth_uids) com o e-mail vitima@x.com.
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'usuarios', 'u_vitima'), { email: 'vitima@x.com', role: 'user', status: 'ativo', telefone: '11999990000' });
    });
  });
  const comEmail = (uid, verificado) =>
    testEnv.authenticatedContext(uid, { email: 'vitima@x.com', email_verified: verificado }).firestore();

  it('conta Auth com o e-mail NÃO verificado não lê o perfil', async () => {
    await assertFails(getDoc(doc(comEmail('fb_invasor', false), 'usuarios', 'u_vitima')));
  });
  it('conta Auth com o e-mail NÃO verificado não altera o perfil', async () => {
    await assertFails(updateDoc(doc(comEmail('fb_invasor', false), 'usuarios', 'u_vitima'), { firebase_auth_uids: ['fb_invasor'] }));
  });
  it('e-mail verificado (ex.: Google) lê o próprio perfil', async () => {
    await assertSucceeds(getDoc(doc(comEmail('fb_dono', true), 'usuarios', 'u_vitima')));
  });
});

describe('fallback global', () => {
  it('coleção desconhecida é negada', async () => {
    await assertFails(getDoc(doc(asOwner(), 'coisa_aleatoria', 'x')));
    await assertFails(setDoc(doc(asOwner(), 'coisa_aleatoria', 'x'), { a: 1 }));
  });
});
