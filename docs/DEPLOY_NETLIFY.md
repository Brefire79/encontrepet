# DEPLOY_NETLIFY.md — Roteiro de teste e deploy da Fase A

> **Data:** 2026-07-20 · Complementa `PLANO_ESTRUTURACAO.md` (Fase A implementada).
> Backend migrado de Cloud Functions → **Netlify Functions** (projeto segue no Spark, custo zero).

## 0. Pré-requisitos (uma vez só)

1. **Service account** (a mesma dos scripts de migração):
   - Codificar em base64: PowerShell →
     `[Convert]::ToBase64String([IO.File]::ReadAllBytes("scripts\serviceAccountKey.json")) | Set-Clipboard`
   - Painel Netlify → *Site settings → Environment variables* → criar
     `FIREBASE_SERVICE_ACCOUNT` = (colar o base64). Escopo: Builds + Functions.
2. **(Opcional) SMTP** para os e-mails de fallback de contato:
   `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. Sem essas vars,
   o app funciona normalmente — só não envia o e-mail "tutor sem contato".
3. Local: `npm install` na raiz (novas deps: `firebase-admin`, `nodemailer`).
   Para o dev local, criar `.env` na raiz com `FIREBASE_SERVICE_ACCOUNT=<base64>`
   (o `.env` já está no `.gitignore`).

## 1. Diagnóstico A0 — Storage (30 segundos)

Console Firebase → **Storage**. Se aparecer "faça upgrade para Blaze" ou o bucket
não existir → Storage indisponível no Spark. **O app continua funcionando**
(feed usa `foto_thumb` in-doc; base64 permanece até haver bucket). Anotar o
resultado — define o item "Storage definitivo" da Fase B.

## 2. Teste local

```bash
netlify dev          # sobe site + functions em http://localhost:8888
```

Roteiro (o mesmo E2E de 2026-07-05):
1. Cadastro de usuário novo → conferir no console Firestore que **não** há
   `senha_hash` no doc `usuarios` e que `senhas_usuarios/<uid>` foi criado.
2. Logout → login por email/senha (passa pelo `login-user`).
3. Tutor A: reportar pet perdido. Avistador B (aba anônima): registrar
   avistamento com a mesma foto perto do local → **B vê o match e A recebe a
   notificação** (era o achado 1 do E2E). Conferir criação de `conversas/{petId}_{avistamentoId}`.
4. Avistamento sem vínculo → tutor próximo recebe notificação de proximidade.
5. Contador "pessoas alcançadas" volta a exibir número (via backend).
6. Revelar contato do tutor/avistador → conferir `lgpd_access_log`.
7. Rules: `npm run test:rules` → **64/64 verde** (revisão 2026-09-23: `fotos`, `vinculos_avistamento`, revert do cross-read do `alert_privado`).

Teste manual dos scheduled (não rodam no `netlify dev` por cron):
```bash
netlify functions:invoke sweep-avistamentos
netlify functions:invoke auto-confirmar-reunioes
```

## 3. Deploy

> **Revisão 2026-09-23:** as rules mudaram (coleções `fotos` e
> `vinculos_avistamento`). Ordem obrigatória: **frontend + functions primeiro,
> rules logo em seguida** (`firebase deploy --only firestore:rules`, conta
> `encontrepet26@gmail.com`). Sem as rules novas, a foto cheia não sai do doc
> público (fica o base64, como hoje) e a confirmação bilateral não acha a
> contraparte — nada quebra, só não melhora.

1. Commits na branch atual (`spike/s08-ownership-via-privado`) — sugestão de mensagens:
   - `feat(backend): migra Cloud Functions para Netlify Functions (custo zero)`
   - `fix(security): remove fallback senha_hash no cadastro (E2E achado 2)`
   - `chore(release): bump SW cache v1.20.0 + changelog`
2. Merge → `main` → push (dispara deploy no Netlify — o `ignore = "exit 0"`
   que bloqueava builds foi removido do `netlify.toml`).
3. Smoke test em produção: repetir passos 1-6 do roteiro acima em
   https://encontre-pet.netlify.app (dados de teste; remover ao final).

## 4. Migrações (após deploy, com aprovação a cada `--apply`)

```bash
node scripts/migrate-s03-senha-hash.js                                  # dry-run
node scripts/migrate-s03-senha-hash.js --apply                          # re-run S-03
node scripts/migrate-s08-owner-firebase-uid.js --phase=backfill         # dry-run
node scripts/migrate-s08-owner-firebase-uid.js --phase=backfill --apply
npm install sharp --no-save                                             # dependência do script de fotos
node scripts/migrate-p0-foto-thumb.js                                   # dry-run
node scripts/migrate-p0-foto-thumb.js --apply                           # thumbs + base64 → fotos/ (só após as rules novas)
# Só depois de 1 semana estável em produção:
node scripts/migrate-s08-owner-firebase-uid.js --phase=strip --apply --i-understand-risk
```

## 5. Monitorar (1 semana)

- Netlify → Functions: invocações e erros (cota free: 125k/mês).
- Console Firestore → uso: reads/writes diários (cota Spark: 50k/20k por dia).
- `lgpd_access_log` e `notificacoes` sendo criados pelos endpoints.

## Notas técnicas

- O diretório `functions/` (TypeScript, Cloud Functions) fica no repo como
  **referência** até o fim da Fase B — não deployar (`deploy:functions` só se
  um dia migrar pra Blaze).
- `generateImageHash` (trigger de Storage) **não** foi portado — detecção de
  duplicatas via hash client-side entra na Fase B.
- Melhoria embutida no port: `get-sighter-contact` verifica ownership também
  via `alert_privado` (a CF original só olhava o campo público, que morre no
  strip do S-08).
- Modal do avistador ainda hardcoded em PT (E2E achado 6) — Fase B, junto com
  a paridade i18n.
