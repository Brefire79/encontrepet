# AGENTS.md — Encontre Pet

Instruções para agentes (Codex e similares) que trabalham neste repositório. Para contexto de produto e convenções completas, ver `CLAUDE.md`.

## O que é
PWA comunitário (Vianexx AI) de reencontro de pets perdidos. **Gratuito ao usuário final**, operando dentro das **cotas free-tier do Firebase Blaze**. North Star: **reuniões confirmadas**.

## Setup do ambiente
- **Sem build/bundler** no front: é Vanilla JS servido estático. Edite os arquivos em `js/` diretamente.
- Front local: `netlify dev` (porta 8888, já no CORS das Functions) ou `firebase emulators:start --only hosting`.
- Functions: TypeScript em `functions/` — `npm --prefix functions install` e `npm --prefix functions run build`.
- Credenciais: **nunca** commitar `serviceAccountKey.json` (está no `.gitignore`). Scripts de migração usam Admin SDK local.

## Como rodar / testar
- **Rules (obrigatório antes de deploy):** `firebase emulators:start --only firestore` e rodar os casos da "Matriz de Acesso Esperada" do `AUDIT.md` — testar **anônimo**, **dono** e **terceiro autenticado** para cada coleção alterada.
- **Smoke manual:** subir o front local, criar alerta, enviar avistamento, conferir matching e revelação de contato.
- **Deploy:** `firebase deploy --only firestore:rules` e `npm run deploy:functions`. Front via Netlify.

## Estilo de código
- Vanilla JS, sem dependências de framework. Manter o padrão de módulos por IIFE/objeto global (`window.AppConfig`, `DB`, `Auth`, `Security`, `I18n`...).
- Reaproveitar helpers existentes (`Security.sanitize*`, `I18n.t`, `AppConfig`).
- Nomes e comentários em PT-BR seguindo o código atual.
- TypeScript estrito nas Functions.

## O que NUNCA fazer
- **Nunca** expor dados de `alert_privado` para não-donos. Acesso de terceiros a contato só via CF `getTutorContact` com log em `lgpd_access_log`.
- **Nunca** criar dependência de serviço pago nem aumentar estruturalmente reads/escritas no Firestore ou invocações de Functions.
- **Nunca** hardcodar threshold (70%) ou raios — usar `js/app-config.js`.
- **Nunca** quebrar paridade i18n: toda string nova entra em `pt.js`, `en.js` e `es.js`.
- **Nunca** commitar `serviceAccountKey.json` ou segredos.
- **Nunca** alterar `firestore.rules` sem rodar os testes do emulator.
- **Nunca** remover `owner_firebase_uid` dos docs públicos sem antes reescrever e testar as rules (ver S-08 em `AUDIT.md` — quebra ownership).

## Convenções rápidas
- `matchId = {petId}_{avistamentoId}` (= `conversaId`).
- Ownership aceita `owner_uid` (`u_xxx`) **OU** `owner_firebase_uid` (Firebase UID), no cliente e nas rules.
- Threshold de match: **70% único**.

## Checklist de PR
- [ ] Mudança verificada contra o código real em produção (Regra de Ouro).
- [ ] Strings novas em PT/EN/ES (paridade).
- [ ] Nenhum threshold/raio hardcoded; veio de `app-config.js`.
- [ ] Sem aumento estrutural de reads/escritas Firestore.
- [ ] Se mexeu em `firestore.rules`: testes do emulator (anônimo/dono/terceiro) passando.
- [ ] Nenhum dado sensível em doc público; `alert_privado`/LGPD respeitados.
- [ ] Um commit por correção de segurança (`fix(security): S-XX — ...`).
- [ ] `AUDIT.md` atualizado se for achado/correção de segurança.
- [ ] Nenhum segredo/service account commitado.
