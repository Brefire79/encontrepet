# TASKS.md — Encontre Pet

Fila viva de trabalho. Detalhes/justificativas ficam nos planos de origem (`PLANO_LANCAMENTO.md`, `PLANO_FASE2.md`, `AUDIT.md`, `docs/DEPLOY_NETLIFY.md`). **Atualize este arquivo ao concluir ou criar tarefa** e registre a versão no `CHANGELOG.md`.

Legenda: `[ ]` aberta · `[x]` feita · 👤 depende do Breno · 🤖 pode ser feita pelo Claude

## Em andamento / próximos
- [ ] 👤 Testar push no celular (notificação de match chegando com app fechado)
- [ ] 👤 Testar cadastro por e-mail/senha ponta a ponta (login Google já validado)
- [ ] 🤖 Revisar esta branch (`spike/s08-ownership-via-privado`) e preparar merge no `main` (produção roda v1.18.0 do `main` conforme `CLAUDE.md`; conferir se ainda é verdade — v1.21.7 já consta no ar)
- [ ] 👤 **S-08 fase `strip`** (~01/10): remover `owner_firebase_uid` dos docs públicos — `node scripts/migrate-s08-owner-firebase-uid.js --phase=strip` (rodar dry-run antes; ver `AUDIT.md`)

## Backend (Netlify Functions no lugar das CFs — decisão 2026-07-20)
- [ ] 🤖 Conferir paridade das functions em `netlify/functions/` com `functions/src/index.ts` (`getTutorContact`, notificação de match, `saveUserPassword`/`verifyUserPassword`)
- [ ] 👤 Re-executar `scripts/migrate-s03-senha-hash.js` após functions no ar (S-03 regride enquanto `senha_hash` for gravado em `usuarios`)
- [ ] 🤖 Validar `countUsersInRadius` (bloqueado pela N-01) via function
- [ ] 🤖 Garantir `linked_pet_owner_firebase_uid` para acesso cruzado LGPD

## Qualidade / segurança
- [ ] 🤖 Rodar Matriz de Acesso do `AUDIT.md` no emulator antes de qualquer deploy de rules
- [ ] 🤖 S-11: ownership no cliente aceitar `owner_uid` **ou** `owner_firebase_uid` (verificar se já fechado no código)

## Docs
- [ ] 🤖 Decidir destino dos `.md` soltos na raiz (`PRD.md`, `PRD_EncontrePet_v2.md`, `PROMPT_ClaudeCode_EncontrePet.md`, `AGENTS.md`, `ESTADO_ATUAL.md`, `PLANO_FASE2.md` estão sem commit) e versioná-los

## Concluído recente
- [x] `docs/ARCHITECTURE.md` reescrito para a arquitetura com Netlify Functions (2026-09-29)
- [x] v1.21.7 — alarme no avistamento compatível + áudio liberado no 1º toque
- [x] v1.21.6 — login Google no localhost usa authDomain padrão
- [x] v1.21.5 — contraste do texto suave no tema claro
- [x] Rules S-08 + N-01..N-03 em produção
