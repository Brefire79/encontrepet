# PLANO_ESTRUTURACAO.md — Estruturação total do Encontre Pet

> **Data:** 2026-07-20
> **Objetivo:** sanar todas as regressões de produção, lançar o app para a comunidade pet
> o quanto antes e mantê-lo **100% gratuito** (sem cartão de crédito / sem Blaze).
> **Decisões registradas (2026-07-20, Breno):**
> 1. **Backend → Netlify Functions** (substitui as Cloud Functions; projeto permanece Spark).
> 2. **Prioridade → lançar rápido** (Fase A resolve o essencial; melhorias em B/C).
> 3. **Git → merge `spike/s08-ownership-via-privado` → `main`** (dispara deploy Netlify).
>
> Complementa: `PLANO_LANCAMENTO.md` (diagnóstico e fases 1-4 já implementadas),
> `PLANO_FASE2.md` (design da confirmação bilateral), `ESTADO_ATUAL.md`, `AUDIT.md`.

---

## 1. Por que Netlify Functions (arquitetura alvo)

O bloqueador nº 1 do lançamento era "Blaze + deploy das functions". Com a decisão de
permanecer sem cartão, as 10 Cloud Functions de `functions/src/index.ts` são substituídas
por **Netlify Functions** (Node + `firebase-admin`), no mesmo repo/deploy do frontend.

- **Custo:** free tier Netlify = 125k invocações/mês + 100h runtime — sobra folga.
- **Admin SDK ignora as rules** (igual às CFs) → **as rules já deployadas em produção
  continuam válidas sem alteração**. O harness 52/52 permanece o gabarito.
- **Credencial:** service account via variável de ambiente Netlify
  (`FIREBASE_SERVICE_ACCOUNT`, JSON base64). **Nunca no repo** (regra existente).
- **Auth:** endpoints verificam o Firebase ID token (`Authorization: Bearer`) com
  `admin.auth().verifyIdToken()`. Endpoints que aceitam anônimo (ex.: processamento de
  avistamento) validam tudo lendo o próprio Firestore — nunca confiam no payload.
- **CORS:** restrito a `https://encontre-pet.netlify.app` + `http://localhost:8888`.

### 1.1 Mapa de migração das 10 CFs

| Cloud Function | Tipo | Substituto Netlify | Fase |
|---|---|---|---|
| `getTutorContact` | onCall | `netlify/functions/get-tutor-contact` (HTTP) | **A** |
| `saveUserPassword` | onCall | `save-user-password` | **A** (S-03) |
| `verifyUserPassword` | onCall | `verify-user-password` | **A** (S-03) |
| `loginUser` | onCall | `login-user` | **A** (N-01) |
| `checkEmailExists` | onCall | `check-email-exists` | **A** (N-01) |
| `notifyTutorContact` | onCall | `notify-tutor-contact` | **A** |
| `getSighterContact` | onCall | `get-sighter-contact` | **A** |
| `onAvistamentoCreated` | **trigger Firestore** | `process-avistamento` (invocado pelo cliente pós-create, **idempotente**) + varredura agendada | **A** |
| `autoConfirmarReunioes` | **scheduled** | Netlify **Scheduled Function** (cron diário) | **B** |
| `generateImageHash` | **trigger Storage** | hash client-side (`js/services/image-hash.js` já existe); versão server fica opcional | **B** |

### 1.2 Substituição do trigger `onAvistamentoCreated` (ponto mais delicado)

Netlify não tem trigger de Firestore. Estratégia:

1. Cliente cria o avistamento com flag `processado: false` e em seguida chama
   `process-avistamento` com `{ avistamentoId }` (fire-and-forget com 1 retry).
2. A function **lê tudo do Firestore** (avistamento + pet + alert_privado), executa o
   trabalho da CF antiga (notificações de match p/ tutor E avistador, criação da
   `conversa` `{petId}_{avistamentoId}`, `sighter_authorizations` /
   `linked_pet_owner_firebase_uid` — reroute do S-08, logs LGPD) e seta
   `processado: true`. **Idempotente**: se já processado, retorna 200 sem efeito.
3. Rede de segurança: Scheduled Function (a cada 6h) varre `avistamentos` com
   `processado == false` criados há > 5 min e reprocessa (cobre cliente que fechou
   o app antes do retry). Custo: ~4 invocações/dia + poucos reads.

### 1.3 Cliente: shim único no lugar de 9 edições

`js/app.js` e `js/auth.js` chamam `functions.httpsCallable(name)` em 9 pontos.
Criar `js/services/backend.js` que expõe um objeto com a **mesma assinatura**
(`httpsCallable(name) → (data) => Promise<{data}>`) fazendo `fetch` para
`/.netlify/functions/{kebab-case(name)}` com o ID token. Trocar apenas a atribuição
da variável `functions` → **zero mudança nos call sites**, fallbacks existentes preservados.

---

## 2. Fase A — Lançamento (sana as 5 regressões do E2E de 2026-07-05)

> Critério de saída: teste E2E de produção repetido com **tutor recebendo notificação**.
> Um commit por item (`fix(...)`/`feat(...)`), aprovação sua antes de cada deploy.

| # | Item | Resolve | Entrega |
|---|---|---|---|
| A0 | **Verificar Firebase Storage no Spark** — o E2E mostrou upload não ocorrendo; Storage p/ buckets novos exige Blaze desde 2024. Confirmar se o bucket do `encontre-pet-137d2` está ativo. Se NÃO: fallback = manter `foto_thumb` no doc (já implementado) + avaliar Cloudinary/Supabase free p/ imagem cheia | E2E achado 6 | diagnóstico + decisão |
| A1 | Scaffold `netlify/functions/` + `firebase-admin` + helper de auth/CORS + `FIREBASE_SERVICE_ACCOUNT` no painel Netlify + ajuste `netlify.toml` | — | infra |
| A2 | Portar os 7 endpoints onCall (tabela 1.1) — lógica copiada de `functions/src/index.ts`, mudando só o envelope HTTP | S-03 regressão, N-01 login, LGPD contato | 7 functions |
| A3 | `process-avistamento` + flag `processado` + retry no cliente (§1.2) | **E2E 1 (North Star), 4 e 5** | function + client |
| A4 | Shim `backend.js` no cliente (§1.3) + remover fallback que grava `senha_hash` em `usuarios` | E2E 2 | client |
| A5 | `count-users-in-radius` (Admin SDK) **ou** remover o contador da UI — decidir com você | E2E 3 | function ou UI |
| A6 | Testes: `netlify dev` local + emulator rules (52/52 devem continuar verdes) + E2E local completo | — | validação |
| A7 | **Merge `spike/s08-...` → `main`** + bump `CACHE_VERSION` → deploy Netlify | — | produção |
| A8 | Migrações manuais (dry-run → apply, com sua aprovação): `migrate-s03-senha-hash.js` (re-run), `migrate-s08 --phase=backfill` depois `strip`, `migrate-p0-foto-thumb.js` | S-03/S-08 legado, custo | dados |
| A9 | E2E de produção (repetir roteiro de 2026-07-05) + monitorar reads/invocações por 1 semana | — | go-live |

**i18n:** toda string nova nos 3 idiomas (inclui o modal do avistador hardcoded em PT — E2E achado 6).

## 3. Fase B — Consolidação (pós-lançamento, semanas 2-4)

1. **Confirmação bilateral de reunião ativa de ponta a ponta** (North Star): código já
   existe (commits `feat(reuniao)`); falta a scheduled function `auto-confirmar-reunioes`
   (cron diário Netlify, timeout 7 dias) + validação E2E.
2. **Detecção de duplicatas reativada**: `imageHash` calculado client-side no submit
   (lib já existe); `process-avistamento` valida/confirma server-side.
3. **Custo fino** (restante do `PLANO_FASE2.md` §1): paginação com cursor (`limit(20)` +
   `startAfter`), unificar os 2 listeners de notificação (decidir campo canônico do
   destinatário), cache de perfil/alertas vistos.
4. **Storage definitivo** conforme A0 (se bucket indisponível: integrar alternativa free).
5. Dashboard admin: North Star = contagem `reuniao_confirmada` (bilateral vs unilateral).

## 4. Fase C — Comunidade e crescimento (mês 2+)

1. **Push notifications** (FCM via Admin SDK funciona no Spark + Netlify) — crítico para
   avistamento ser visto rápido; hoje a notificação só aparece com o app aberto.
2. **Capacitor**: build Android para distribuir na comunidade fora do navegador.
3. **Compartilhamento social** de alerta (cartaz do pet gerado no client, link direto).
4. Patrocínios Bronze/Prata/Ouro (modelo já previsto no PRD) — só se houver custo a cobrir.
5. Onboarding da comunidade: guia de uso (já existe em docs/marketing), moderadores.

---

## 5. Orçamento de gratuidade (limites e uso esperado)

| Recurso | Free tier | Uso estimado (comunidade ~500 usuários) | Risco |
|---|---|---|---|
| Firestore Spark | 50k reads / 20k writes / dia | feed com cache TTL + thumbs ≈ 3-8k reads/dia | Baixo |
| Netlify Functions | 125k invocações + 100h / mês | ~100-300 invocações/dia | Baixíssimo |
| Netlify banda | 100 GB/mês | thumbs in-doc reduzem egress do Firestore; assets ~2-5 GB | Baixo |
| Firebase Auth | ilimitado (email/senha) | — | Nenhum |
| Storage | **verificar A0** | fotos cheias | **Aberto** |

Guarda-corpos já no código: cache TTL do feed, `foto_thumb`, rate limiting client + server.

## 6. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Storage indisponível no Spark (A0) | fallback thumb-only já funciona; alternativa free na Fase B |
| Cliente não chama `process-avistamento` (app fechado) | varredura agendada 6/6h (§1.2) |
| Cold start Netlify (~1-2s) | aceitável; endpoints críticos são pós-ação, não bloqueiam render |
| Service account exposta | só em env var Netlify; escopo mínimo; rotação se vazar |
| Rules × Admin SDK divergirem | harness do emulator continua obrigatório antes de qualquer deploy de rules |
| Migrações em produção | sempre dry-run primeiro + aprovação manual (regra existente) |

## 7. Ordem de execução e checkpoints de aprovação

```
A0 diagnóstico Storage ─► você decide fallback
A1-A5 implementação    ─► review + netlify dev local
A6 testes verdes       ─► você aprova o merge
A7 merge + deploy      ─► smoke test produção
A8 migrações (dry-run) ─► você aprova cada --apply
A9 E2E produção OK     ─► lançamento na comunidade 🚀
B/C conforme demanda
```

**Nada é executado sem sua aprovação em cada checkpoint.** `functions/` (TypeScript) fica
no repo como referência até a Fase B terminar; depois decidimos arquivar.
