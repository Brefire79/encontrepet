# scripts/ — Migrações de dados (Admin SDK)

Scripts Node idempotentes para migrações de segurança do `AUDIT.md`. Todos usam
`firebase-admin` e exigem credencial de service account **local** — que **nunca**
deve ser commitada (já está no `.gitignore`).

## Pré-requisitos

```bash
npm i firebase-admin            # se ainda não estiver disponível
export GOOGLE_APPLICATION_CREDENTIALS="./serviceAccountKey.json"
```

Todos os scripts rodam em **DRY-RUN por padrão** (só relatam). Use `--apply` para escrever.

## migrate-s03-senha-hash.js  (S-03)

Remove `senha_hash`/`senha_salt` legados dos docs públicos `usuarios`, copiando o
hash para `senhas_usuarios/{uid}` (coleção protegida) antes de apagar.

```bash
node scripts/migrate-s03-senha-hash.js            # dry-run
node scripts/migrate-s03-senha-hash.js --apply    # executa
```

Seguro e idempotente. As CFs `saveUserPassword`/`verifyUserPassword` já usam
`senhas_usuarios`; este script só limpa documentos antigos.

## migrate-s08-owner-firebase-uid.js  (S-08)  ⚠️

Tira `owner_firebase_uid` dos docs públicos (`pets_perdidos`, `avistamentos`),
mantendo-o só em `alert_privado`.

> **ATENÇÃO — bloqueio arquitetural.** As rules atuais verificam ownership em docs
> públicos por `owner_firebase_uid == request.auth.uid`. Como `owner_uid` (`u_xxx`)
> ≠ Firebase Auth UID, remover o campo **sem antes reescrever e testar as rules**
> faz o dono perder create/update/delete do próprio alerta. Por isso a remoção é
> separada em duas fases.

Sequência correta:

```bash
# 1) Fase segura: copia o UID para alert_privado
node scripts/migrate-s08-owner-firebase-uid.js --phase=backfill --apply

# 2) Reescrever firestore.rules para ownership não depender do campo público
#    (ex.: verificar via get() no alert_privado correspondente).
# 3) Validar no Firestore Rules emulator (anônimo / dono / terceiro autenticado).
# 4) Deploy das rules novas.

# 5) Só então: remove o campo dos docs públicos (gated)
node scripts/migrate-s08-owner-firebase-uid.js --phase=strip --apply --i-understand-risk
```

A fase `strip` recusa rodar sem `--i-understand-risk` e pula qualquer doc cujo
backfill ainda não tenha sido feito.

## migrate-p0-foto-thumb.js  (P0 custo)

Gera `foto_thumb` (~10KB, 200px) a partir do `foto_comprimida` legado e zera o
base64 grande nos docs públicos que já têm `imageStorageUrl` (a imagem cheia
fica só no Storage). Docs sem cópia no Storage mantêm o base64. Motivação: cada
abertura de feed lia até 400 docs com ≤120KB de base64 cada — egress insustentável
na cota grátis.

Dependência extra: `npm install sharp --no-save`.

```bash
node scripts/migrate-p0-foto-thumb.js            # dry-run
node scripts/migrate-p0-foto-thumb.js --apply    # executa
```

Idempotente; pode rodar quantas vezes quiser.

## Status atual (2026-06-12)

- **S-03:** script pronto. Rodar quando conveniente.
- **S-08:** `backfill` pronto e seguro. `strip` **gated** — aguarda decisão sobre o
  redesenho das rules de ownership + testes no emulator (que estava indisponível
  na sessão de auditoria).
