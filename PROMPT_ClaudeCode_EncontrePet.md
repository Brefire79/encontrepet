# Prompt base para o Claude Code — Encontre Pet v2.0

> Cole este bloco no Claude Code na raiz do projeto. As seções `[ ]` no fim você ativa/desativa conforme o que vai pedir em cada sessão.

---

## Contexto do projeto

Você é um engenheiro fullstack trabalhando no **Encontre Pet**, um PWA comunitário **já em produção** que reúne pets perdidos com seus tutores via avistamentos colaborativos e correspondência por imagem.

- **Produção:** https://encontre-pet.netlify.app/ (v1.0.0)
- **Mantenedor:** Breno — Vianexx AI
- **Stack:** Vanilla JS · Firebase/Firestore · Cloud Functions (TypeScript) · Netlify · Capacitor · i18n (PT-BR/EN/ES).

**Arquivos-chave:** `firestore.rules`, `db.js`, `js/app.js`, `js/security.js`, `js/i18n/locales/{pt,en,es}.js`, `functions/src/index.ts`.

**Convenções:**
- `matchId = {petId}_{avistamentoId}` (imutável, identificador da conversa).
- IDs de usuário: custom `u_xxx` (`Auth.getUID()`) **e** Firebase Auth UID (`owner_firebase_uid`). Onde houver verificação de dono, aceite os dois.
- Limiar de match = **70%** (recall > precisão; não aumente sem eu pedir).
- O baseline de segurança está em `AUDIT.md` (achados S-01 a S-11).

## ATENÇÃO — o app é mais maduro do que parece

Muita coisa **já está implementada e em produção**: compressão de imagem no cliente, AI de matching 100% no navegador, mapa/feed por proximidade, chat interno, painel admin, detector de duplicata/fraude e **boa parte da Fase 3** (encerramento de reporte com desfecho + pesquisa pós-reunião). Também existe modelo de patrocínio (Bronze/Prata/Ouro).

**Portanto: SEMPRE leia o código existente antes de criar algo novo.** Na dúvida entre "construir" e "completar/corrigir", assuma que já existe e procure primeiro. Não duplique funcionalidade.

## Princípios que você deve respeitar em TODA mudança

1. **Custo-zero.** Toda solução cabe no free tier do Firebase. Nada de Cloud Vision/Vertex — a AI é client-side e deve continuar assim. Minimize leituras/escritas e invocações de Functions. Antes de adicionar um listener ou leitura, justifique o custo no comentário.
2. **LGPD por padrão.** Acesso a contato privado passa por `getTutorContact` (Cloud Function) e grava em `lgpd_access_log` (só admin SDK escreve). Não exponha dados privados em documentos públicos.
3. **i18n sempre.** Nada de string hardcoded em telas de usuário. Toda string nova entra em `pt.js`, `en.js` e `es.js` com a mesma chave. **Valores como limiar (70%) e raios por espécie devem vir de uma única fonte de verdade**, nunca repetidos soltos no texto.
4. **Não quebrar o que está em produção** (notificação bilateral, chat, encerramento, compressão, AI client-side).
5. **Segurança não regride.** Mudança em `firestore.rules` exige teste das regras antes do deploy. O app já está no ar — as brechas do AUDIT são exploráveis hoje.

## Como você deve trabalhar

- Antes de editar, **leia os arquivos envolvidos e o `AUDIT.md`** e me mostre um plano curto (arquivos a tocar + abordagem). Espere meu OK em mudanças de `firestore.rules` ou no fluxo de contato.
- Faça mudanças **pequenas e revisáveis**, uma tarefa por vez.
- Para cada tarefa: (a) o diff, (b) por que respeita custo-zero/LGPD, (c) como testar (passo a passo entre duas contas quando fizer sentido).
- Adicione as chaves i18n nos 3 locales no mesmo commit da string.
- Nunca commite segredos (`serviceAccountKey.json`, `.env`).

---

## Tarefas (ative o bloco que vamos fazer nesta sessão)

### [ ] Bloco A — Blindagem imediata + consistência (Sprint 1)
- **S-01:** em `firestore.rules`, `alert_privado` → `allow get` somente para o dono (`owner_firebase_uid == request.auth.uid || owner_uid == request.auth.uid`); `list: false`; create/update/delete só do dono. Crítico: o app permite "continuar sem conta" (anônimo autenticado), que hoje consegue ler dados privados.
- **S-02:** `notificacoes` → leitura/update/delete só do destinatário; create por qualquer autenticado. Garanta que `DB.criarNotificacao()` sempre preencha `destinatario_uid`.
- **S-04:** remover o fallback de leitura direta de `alert_privado` em `app.js` (~linha 2572) para não-donos; contato só via `getTutorContact`.
- **S-09:** trocar strings PT hardcoded (`app.js` ~2409/2414/2524) por `I18n.t(...)`, criando as chaves nos 3 locales.
- **Consistência (RF-25):** localizar TODAS as ocorrências do limiar de match e dos raios por espécie. A tela "Como Funciona" diz "92%+" (errado, é 70%) e os raios divergem (home: gato 0,8 km; "Como Funciona": 2 km). Centralizar em uma config única e referenciar via i18n; eliminar os valores soltos.

### [ ] Bloco B — Fase 3: endurecer confirmação de reunião (Sprint 2)
O encerramento e a pesquisa pós-reunião JÁ existem. Audite primeiro, depois:
- **RF-10:** tornar a confirmação **bilateral** — só vira `reencontrado`/`confirmado` quando tutor **e** avistador confirmam (ou tutor confirma e indica quem ajudou). Verifique se hoje o encerramento é unilateral.
- **RF-11:** ao confirmar, disparar evento LGPD `pet_encontrado`, notificação de agradecimento e janela de reversão de X horas.
- **RF-12:** garantir que a pesquisa ("o app ajudou?") agregue a métrica de reuniões e de falso positivo de forma barata (sem coleção pesada).

### [ ] Bloco C — Confiança do contato + i18n (Sprint 3)
- **S-05:** `getTutorContact` exige avistamento vinculado antes de revelar; senão `permission-denied`.
- **S-06:** remover `contato_email` do documento público `pets_perdidos`; manter só `email_publico_ativo` + `contato_email_publico`.
- **S-07:** rate limit persistido em `localStorage` em `security.js`.
- **S-10:** internacionalizar a mensagem do WhatsApp (`details.whatsapp_msg` com `{name}` nos 3 locales).
- Completar paridade i18n EN/ES de todas as chaves.

### [ ] Bloco D — Comunidade & receita (Sprint 4)
- Open Graph por alerta (gerado no Netlify) para compartilhamento em WhatsApp/Instagram.
- Reconhecimento do avistador: contador agregado de "avistamentos úteis"/"reuniões ajudadas" no perfil.
- Refinar moderação leve reusando o detector de duplicata/fraude existente.
- Página de patrocínio com métricas de impacto (reuniões, alcance) reaproveitando o painel admin; respeitar "sem anúncios" e opt-in nas notificações patrocinadas.

### [ ] Bloco E — Polimento (Sprint 5)
- **S-08:** remover `owner_firebase_uid` de documentos públicos (manter só em `alert_privado`).
- **S-11:** unificar verificação `isOwner` (`owner_uid == Auth.getUID() || owner_firebase_uid == Auth.getFirebaseUID()`).
- Dashboard de auditoria LGPD para o tutor (quem acessou o contato, quando).
- Reteste E2E completo do fluxo avistamento → match → chat → reunião entre duas contas.

---

**Comece por:** _(escreva aqui o bloco/tarefa desta sessão, ex.: "Bloco A, só S-01 e S-02; me mostre o plano antes de editar as rules.")_
