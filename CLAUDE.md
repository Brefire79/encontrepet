# CLAUDE.md — Encontre Pet (memória de sessão para Claude Code)

## Visão do produto
PWA comunitário da **Vianexx AI** que reúne pets perdidos com seus tutores via avistamentos colaborativos e **matching de imagem por IA client-side**. **Gratuito para o usuário final** e o mais próximo possível de **autossuficiente em custo** (patrocínios Bronze/Prata/Ouro só cobrem o Firebase Blaze).

- **North Star:** reuniões confirmadas (pet + tutor).
- **Restrição de custo zero:** minimizar reads/escritas no Firestore e invocações de Cloud Functions. Preferir client-side quando seguro. Cotas free-tier valem mesmo no Blaze.
- **LGPD é requisito permanente** em qualquer feature que toque dados de usuário.

> **REGRA DE OURO:** o app em produção está **mais maduro que a documentação**. Verifique o código real antes de planejar ou alterar. Nunca assuma que algo não existe — procure primeiro.

## Stack
Vanilla JS (sem framework), Firestore, Cloud Functions (TypeScript), Firebase Auth, **Netlify** (escolhido pelo limite de banda > Firebase Hosting), Capacitor, i18n PT-BR/EN/ES. Project ID Firebase: `encontre-pet-137d2`.

## Estrutura / arquivos-chave
- `firestore.rules` — regras de acesso (canônico de segurança junto com `AUDIT.md`).
- `js/app-config.js` — **fonte única** de thresholds e raios.
- `js/app.js` — app principal, navegação, detalhes, fluxo de contato, fechamento.
- `js/db.js` — camada Firestore (CRUD, listeners, `criarNotificacao`, `getPrivateAlertData`, `marcarEncontrado`).
- `js/security.js` — sanitização, rate limiting (localStorage), ofuscação.
- `js/auth.js` — autenticação (REST) + identidade dupla.
- `js/ai-match.js`, `js/ai-vision.js`, `js/services/{image-hash,similarity}.js` — matching IA.
- `js/i18n/locales/{pt,en,es}.js` + `js/i18n.js` — internacionalização.
- `functions/src/index.ts` — Cloud Functions (`getTutorContact`, trigger `onAvistamentoCreate`, `saveUserPassword`/`verifyUserPassword`).
- `scripts/` — migrações Admin SDK (idempotentes, dry-run por padrão).

## Convenções (não negociáveis)
- **`matchId = {petId}_{avistamentoId}`** (também usado como `conversaId`).
- **Identidade dupla:** o app usa ID customizado **`u_xxx`** (`owner_uid`) **E** Firebase Auth UID (`owner_firebase_uid`). Toda verificação de ownership deve aceitar **ambos** (cliente e rules).
- **Thresholds:** **70%** = sugestão/exibição de match (decisão 2026-06: gatilho **único**, recall > precisão). Não há mais ≥92%. Valores sempre de `app-config.js` — **nunca hardcodar** threshold/raio na UI.
- **Raios por espécie:** `{ cao: 5, gato: 0.8, outro: 3 }` km, em `app-config.js`.
- **LGPD:** acesso a contato de não-dono só via CF `getTutorContact`, sempre com log em `lgpd_access_log`.
- **Nunca commitar `serviceAccountKey.json`** (já no `.gitignore`).

## Regras de trabalho
- Verificar o app em produção **antes** de planejar (Regra de Ouro).
- Tratar `AUDIT.md` (S-01..S-11) como referência canônica de segurança.
- **Um commit por correção**; mensagem `fix(security): S-XX — <título>` para achados.
- **Rodar testes do Firestore Rules emulator antes de qualquer deploy de rules** (gabarito: "Matriz de Acesso Esperada" do `AUDIT.md`).
- **i18n nos 3 idiomas** para toda string nova (paridade pt/en/es).
- Nunca expor dados de `alert_privado` para não-donos. Nenhuma string nova fora do i18n. Nenhum número de threshold/raio divergente entre telas. Nenhum aumento estrutural de reads.

## Estado de segurança (2026-07)
11/11 no código; **rules novas (S-08 + N-01..N-03) já deployadas em produção** (constatado 2026-07-05). Restam as fases manuais: migração `backfill`/`strip` do S-08 e re-run do `migrate-s03-senha-hash.js` **após** o deploy das Cloud Functions.
**Atenção:** projeto em **Spark** (sem CFs no ar) → regressões silenciosas ativas em produção: tutor não recebe notificação de match, cadastro grava `senha_hash` em `usuarios` (S-03 regride), `countUsersInRadius` bloqueado pela N-01, acesso cruzado LGPD sem `linked_pet_owner_firebase_uid`. Detalhes: `PLANO_LANCAMENTO.md` §"Teste E2E".
**Decisão 2026-07-20:** sem Blaze — backend = **Netlify Functions** (`netlify/functions/`, Admin SDK) substituindo as CFs; `functions/` fica só como referência. Sem bucket de Storage no Spark: foto cheia em `fotos/{colecao}_{id}` (`AppConfig.USE_FIREBASE_STORAGE=false`). Roteiro de deploy: `docs/DEPLOY_NETLIFY.md`. Produção ainda roda o `main` (v1.18.0) até o merge desta branch.

## Comandos úteis
```bash
# Emuladores Firebase (hosting + rules + functions)
firebase emulators:start

# Deploy de rules
firebase deploy --only firestore:rules

# Deploy de functions
npm run deploy:functions          # = firebase deploy --only functions

# Servir local (Netlify Dev usa :8888; já está no CORS das functions)
netlify dev

# Migrações (dry-run por padrão; precisa serviceAccountKey.json local)
node scripts/migrate-s03-senha-hash.js
node scripts/migrate-s08-owner-firebase-uid.js --phase=backfill
```

Documentos relacionados: `PRD.md`, `AGENTS.md`, `AUDIT.md`, `ESTADO_ATUAL.md`, `PLANO_FASE2.md`, `docs/MANUAL_TECNICO.md`.
