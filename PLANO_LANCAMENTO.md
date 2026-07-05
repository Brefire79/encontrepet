# PLANO_LANCAMENTO.md — Preparação para lançamento comunitário

> **Data:** 2026-07-04
> **Objetivo:** deixar o app sustentável em custo zero (free-tier Blaze) e sem pendências
> de segurança/LGPD antes de abrir para a comunidade pet.
> **Origem:** avaliação de custo + segurança de 2026-07-04 (ver conversa/commit). Complementa
> `PLANO_FASE2.md` (os itens de custo 1.1–1.3 de lá foram **promovidos a pré-requisito de
> lançamento** por esta avaliação).

---

## Diagnóstico resumido

1. **Custo (bomba-relógio):** `foto_comprimida` (base64 ≤120KB) + `embedding` são gravados
   no doc público (`db.js` 417/738), e o feed abre 2× `onSnapshot limit(200)`. Com 200
   alertas ativos: ~400 reads e ~50MB de egress **por abertura de feed** → cota grátis
   permite ~125 aberturas/dia. O upload pro Storage já existe (`db.js` 470/813), mas o
   base64 nunca é removido do doc.
2. **Segurança:** 9/11 do `AUDIT.md` corrigidos. Pendente: **S-08** (gated; spike validado
   9/9 nesta branch). **3 achados novos** nas rules atuais:
   - **N-01 (ALTO/LGPD):** `usuarios` listável por qualquer autenticado (nome/email/telefone
     enumeráveis) — `firestore.rules` 179.
   - **N-02 (MÉDIO):** `notificacoes` create sem validação de conteúdo (spam/phishing
     interno) — `firestore.rules` 215.
   - **N-03 (BAIXO):** `lgpd_access_log` create sem amarrar o ator ao `auth.uid` (poluição
     do log de auditoria) — `firestore.rules` 142.

---

## Fases (ordem de execução)

### Fase 1 — Fotos fora do doc público (custo, ~90% do egress)
- Novo campo público `foto_thumb` (thumbnail 200px/q0.5 do `image-utils.js`, ~10KB).
- Após upload no Storage concluir, o update em background zera `foto_comprimida` no doc.
- Renderização por helpers: feed/cards usam `foto_thumb` (in-doc, barato); detalhe/match
  usam `imageStorageUrl` (qualidade cheia, cacheável pelo browser/SW).
- Script `scripts/migrate-p0-foto-thumb.js` (idempotente, dry-run): gera `foto_thumb` a
  partir do base64 legado e zera `foto_comprimida` quando `imageStorageUrl` existe.
- **Não quebra matching:** `ai-match` compara `foto_hash`/`embedding`, não o base64.

### Fase 2 — Feed sem realtime (custo)
- `watchPetsAtivos`/`watchAvistamentos` passam a `get()` com cache TTL (60s) em memória;
  refresh ao voltar pra home após expirar TTL. Realtime permanece **só** em notificações
  e no doc de detalhe aberto.

### Fase 3 — Hardening de rules (N-01, N-02, N-03)
- **N-01:** login/cadastro/recuperação deixam de listar `usuarios` por query aberta;
  resolução de email via Cloud Function (Admin SDK, rate-limited). Rules:
  `allow list: if isFirestoreAdmin()`. Cliente mantém fallback até o deploy das functions.
- **N-02:** create de `notificacoes` validado (tipos permitidos, tamanhos, campos).
- **N-03:** create de `lgpd_access_log` exige `actor_firebase_uid == request.auth.uid` +
  esquema mínimo.
- Testes novos no harness `test/rules/` (emulator) antes de qualquer deploy.

### Fase 4 — S-08 (remoção de `owner_firebase_uid` dos docs públicos)
Ordem do `AUDIT.md` §S-08, com o spike desta branch como base:
1. Reroute: notificação de match e `sighter_authorizations`/`linked_pet_owner_firebase_uid`
   passam a ser criados pela CF `onAvistamentoCreate` (Admin SDK) — o cliente para de
   depender do campo público.
2. Rules: ownership via `alert_privado` (spike `test/rules/firestore.rules.s08`, 9/9 verde)
   integrado ao `firestore.rules` real.
3. `npm test` no harness completo (matriz de acesso + S-08).
4. Fase `strip` do script de migração (produção, manual — ver "Deploy").

### Fase 5 — Validação e visualização local
- Suite completa do emulator verde; bump do `CACHE_VERSION` do SW; um commit por fase;
- Servidor local no ar para inspeção visual.

---

## Ordem de deploy em produção (manual, fora deste changeset)

> **Atualização 2026-07-05:** o passo 3 (rules) **já está deployado em produção**
> (verificado via API — as rules ativas são as novas, com `ownsAlertViaPrivate` +
> N-01..N-03). Com as CFs ausentes (projeto ainda em **Spark**), isso deixa o app
> em estado intermediário com regressões silenciosas — ver "Teste E2E" abaixo.
> **O bloqueador nº 1 do lançamento é o upgrade para Blaze + deploy das functions.**

1. `node scripts/migrate-s08-owner-firebase-uid.js --phase=backfill --apply`
2. **Upgrade Blaze** + `npm run deploy:functions` (CFs novas: resolução de email + reroute do match) — **URGENTE, ver teste E2E**
3. ~~`firebase deploy --only firestore:rules`~~ ✅ **já em produção** (constatado 2026-07-05)
4. `node scripts/migrate-p0-foto-thumb.js --apply` (thumbs + strip do base64)
5. `node scripts/migrate-s08-owner-firebase-uid.js --phase=strip --apply --i-understand-risk`
6. Publicar frontend (Netlify) e monitorar reads/egress no console por 1 semana.
7. Configurar **alerta de orçamento** no GCP (budget baixo, alerta em 50%).

## Teste E2E em produção (2026-07-05)

Fluxo testado com dados reais (semeados e removidos ao final): avistamento anônimo →
cadastro de tutor → pet perdido → avistamento vinculado via match IA → notificações.
**Resultado: o tutor nunca recebe notificação em produção**, embora a UI afirme o
contrário em 3 pontos. Achados, por gravidade:

1. **Notificações de match/avistamento não são criadas** — dependem 100% da CF
   `onAvistamentoCreate` (inexistente). O modal `showAvistadorMatchFeedback` e os
   toasts dizem "O tutor foi notificado" (falso). North Star quebrado. → só resolve
   com Blaze + deploy das functions.
2. **Regressão S-03 no cadastro**: sem a CF `saveUserPassword`, o fallback grava
   `senha_hash` dentro do doc `usuarios`. Re-rodar `migrate-s03-senha-hash.js` após
   o deploy das CFs.
3. **`countUsersInRadius` quebrado pela N-01** (`list limit 200` vs rule `limit <= 1`):
   contador "pessoas alcançadas" e toast de alcance nunca funcionam. → CF de count
   ou aceitar remoção do contador.
4. **Bug `geoDistKm` (ai-match.js)**: lia `pet.latitude`, mas docs públicos só têm
   `latitude_publica` → distância ∞; gate anti-fraude descartava foto idêntica ao
   lado do pet e G2 (50 km) nunca descartava. ✅ **CORRIGIDO em 2026-07-05**
   (fallback para `latitude_publica`; validado no app: match idêntico próximo = 100%,
   60 km = `too_far`).
5. **Acesso cruzado LGPD inoperante em docs novos**: `linked_pet_owner_firebase_uid`
   fica vazio (público sem `owner_firebase_uid` + sem CF) → `sighter_authorization`
   não é criada. → resolve com CF de reroute.
6. Menores: detecção de duplicatas inativa (`imageHash` é CF-gerado); modal do
   avistador hardcoded em PT (fora do i18n); upload Storage não ocorreu no teste
   (base64 permaneceu nos docs; investigar storage.rules/auth anônima).

## Status de execução (2026-07-04)

- ✅ **Fase 1** — `foto_thumb` no doc + strip do base64 pós-upload + helpers de render +
  `scripts/migrate-p0-foto-thumb.js` (commit `perf(custo): fotos...`).
- ✅ **Fase 2** — feed via polling com cache TTL compartilhado; realtime só em
  notificações/chat/detalhe (commit `perf(custo): feed...`).
- ✅ **Fase 3** — N-01..N-04: CFs `loginUser`/`checkEmailExists`, vínculo
  `firebase_auth_uids`, rules de `usuarios`/`notificacoes`/`lgpd_access_log`
  (commit `fix(security): N-01..N-04...`).
- ✅ **Fase 4** — S-08 código completo: rules `ownsAlertViaPrivate`, reroute via
  `onAvistamentoCreate`/`notifyTutorContact`, cliente sem o campo público
  (commit `fix(security): S-08...`).
- ✅ **Testes**: harness do emulator **52/52 verde** (revalidado 2026-07-05).
- ✅ **Rules em produção** (constatado 2026-07-05 — deploy já havia sido feito).
- ✅ **Fix `geoDistKm`** (2026-07-05, achado do teste E2E — v1.19.1).
- ⏳ **Pendente (produção, manual)**: Blaze + functions + migrações — seção
  "Ordem de deploy" e achados do "Teste E2E" abaixo.

> Nota de ambiente (Windows): o emulator do Firestore requer
> `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\PROJETOS\jtmp` nesta máquina
> (o tmpdir padrão quebra o socket UDS interno do Java).

## Critérios de aceite

- Feed renderiza com docs sem base64 (thumb) e detalhe com imagem do Storage.
- Nenhum aumento estrutural de reads; redução mensurável de egress.
- Harness de rules 100% verde (matriz de acesso + novos casos N-01/02/03 + S-08).
- Nenhuma string nova fora do i18n (paridade pt/en/es).
- Login/cadastro/recuperação funcionam antes e depois do deploy das functions (fallback).
