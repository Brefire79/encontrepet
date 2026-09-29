# TASKS.md — Encontre Pet

Fila viva de trabalho. Detalhes/justificativas ficam nos planos de origem (`PLANO_LANCAMENTO.md`, `PLANO_FASE2.md`, `AUDIT.md`, `docs/DEPLOY_NETLIFY.md`). **Atualize este arquivo ao concluir ou criar tarefa** e registre a versão no `CHANGELOG.md`.

Legenda: `[ ]` aberta · `[x]` feita · 👤 depende do Breno · 🤖 pode ser feita pelo Claude

## Em andamento / próximos
- [ ] 👤 Testar push no celular (notificação de match chegando com app fechado)
- [ ] 👤 Testar cadastro por e-mail/senha ponta a ponta (login Google já validado)
- [ ] 👤 Fazer o merge do PR de documentação no `main` (só `.md`, sem mudança no app; o backend Netlify já está no `main`/no ar na v1.21.7)
- [ ] 👤 Conferir no Netlify que `FIREBASE_SERVICE_ACCOUNT` está definida e no Firebase que as rules de 2026-09-23 (`fotos`, `vinculos_avistamento`) foram publicadas
- [ ] 👤 **S-08 fase `strip`** (~01/10): remover `owner_firebase_uid` dos docs públicos — `node scripts/migrate-s08-owner-firebase-uid.js --phase=strip` (rodar dry-run antes; ver `AUDIT.md`)

## Backend (Netlify Functions no lugar das CFs — decisão 2026-07-20)
- [ ] 👤 Re-executar `scripts/migrate-s03-senha-hash.js` após functions no ar (S-03 regride enquanto `senha_hash` for gravado em `usuarios`)

## Qualidade / segurança

## Docs

## Concluído recente
- [x] 2026-09-29 — verificação: todas as CFs têm equivalente em `netlify/functions/` (exceto `generateImageHash`, que depende de Storage e não se aplica); `countUsersInRadius` passa pela function; `linked_pet_owner_firebase_uid` é gravado em `db.js` e `_lib/avistamento-core.js`; S-11 já fechado em `app.js` (~2985); rules emulator: 69/69 passando
- [x] `.md` da raiz e manuais versionados
- [x] `docs/ARCHITECTURE.md` reescrito para a arquitetura com Netlify Functions (2026-09-29)
- [x] v1.21.7 — alarme no avistamento compatível + áudio liberado no 1º toque
- [x] v1.21.6 — login Google no localhost usa authDomain padrão
- [x] v1.21.5 — contraste do texto suave no tema claro
- [x] Rules S-08 + N-01..N-03 em produção
