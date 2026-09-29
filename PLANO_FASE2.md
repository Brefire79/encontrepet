# PLANO_FASE2.md — Consistência, custo e confirmação bilateral

> **Data:** 2026-06-12
> **Por que um plano antes do código:** os dois itens estruturais da Fase 2 (otimização de
> reads e confirmação bilateral de reunião) tocam o data layer de um app **em produção** e
> exigem validação no **Firestore Rules emulator** + deploy de Cloud Functions — ambiente que
> estava **indisponível nesta sessão** (sandbox Linux fora do ar). Este documento deixa o
> design e os diffs prontos para implementar com teste. Os itens **seguros e isolados já foram
> aplicados** (ver checklist no fim).

---

## ✅ Já aplicado nesta sessão (Fase 2, sem risco)

- **Consistência de UI (threshold/raio):** nada a fazer — já vêm de `js/app-config.js` (fonte
  única); todas as telas/locales leem de lá. Ver `ESTADO_ATUAL.md` §2 e §3.
- **i18n da notificação de match:** `js/ai-match.js` `generateMatchNotification` agora usa
  `I18n.t('match.notify_high'|'match.notify_low', { score, name })`, com chaves novas em
  `pt/en/es` (`match.your_pet`, `match.notify_high`, `match.notify_low`).
  - *Limitação conhecida:* a mensagem é gravada no Firestore no momento da criação, então fica
    no idioma do avistador. Para tornar 100% dinâmico no idioma do leitor, gravar uma `chave +
    params` em vez do texto e resolver na renderização (item opcional, baixo impacto).

---

## 1. Otimização de custo Firestore (cotas free-tier Blaze)

### Diagnóstico (estado real)

| Ponto | Hoje | Arquivo |
|---|---|---|
| Feed home (pets + avistamentos) | 2× `onSnapshot` com `limit(200)` (tempo real contínuo) | `db.js` ~1411-1436 |
| Notificações | 2× `onSnapshot` (por `destinatario_firebase_uid` e `destinatario_uid`) | `db.js` ~1297-1311 |
| Pets ativos / listagens | `limit(100/200)` sem cursor | `db.js` ~562-577, 1376-1381 |

### Mudanças propostas (ordem de risco crescente)

1. **Cache TTL no feed (baixo risco, alto ganho).** Antes de abrir o `onSnapshot`, servir do
   `localStorage` (TTL ~60s) para render instantâneo; abrir o listener só se o cache expirou ou
   a tela ficou aberta > X s. Reduz reads em navegações repetidas.
   - *Onde:* wrapper em `db.js` em volta de `listenPetsAtivos`/feed loader.
   - *Validação:* contar reads no console do Firestore antes/depois.

2. **Trocar realtime por `get()` no feed (médio).** O feed não precisa de tempo real; um
   `get()` + botão "atualizar" (ou refresh on focus) corta reads recorrentes. Manter realtime
   só para **notificações** (onde tempo real importa).

3. **Paginação real (médio).** `limit(20)` + cursor `startAfter(lastDoc)` no "Ver todos", em vez
   de `limit(200)` fixo.

4. **Unificar listeners de notificação (médio).** Hoje 2 listeners cobrem o mismatch de UID.
   Após padronizar o destinatário (idealmente um único campo canônico), cair para 1 listener.
   Depende de decisão de identidade (relacionado a S-08/S-11).

5. **Cache de perfil e "alertas já vistos" (baixo).** `localStorage`/IndexedDB com TTL para
   dados pouco voláteis.

**Critério de aceite:** nenhum aumento estrutural de reads; idealmente redução mensurável no
console do Firestore. Cada mudança validada isoladamente.

---

## 2. PWA / performance (verificação)

- **Service worker e cache de assets:** confirmar estratégia (já há banner de update obrigatório
  em `index.html`). Versionar assets por query (`?v=`) já é usado.
- **Lazy-load do mapa e do engine de IA:** TF.js/MobileNet já é injetado sob demanda por
  `AIVision.loadModel()` (comentário em `index.html` ~34). Validar que o mapa também só carrega
  ao abrir a aba.
- **Compressão de imagem:** já existe (`js/image-utils.js`); validar limites de dimensão/qualidade
  antes do upload.

---

## 3. Confirmação **bilateral** de reunião (North Star) — DESIGN

### Estado atual (unilateral)

`app.js` `btn-send-feedback` → `DB.marcarEncontrado(petId, { desfecho })` grava `status` +
`desfecho` direto (`db.js` 519-536). Não há contraparte confirmando.

### Decisão de escopo (importante)

Confirmação bilateral **só faz sentido quando há contraparte conhecida** — ou seja, existe um
avistamento vinculado / `conversa` (`conversaId = {petId}_{avistamentoId}`) entre tutor e
avistador. Quando o pet é encontrado **fora do app** (sem match), o fluxo continua **unilateral**
como hoje. O fluxo bilateral é condicional à existência de match vinculado.

### Modelo de dados (proposto)

No doc `pets_perdidos` (ou em `alert_privado` para campos sensíveis):
- `status`: `ativo` → `aguardando_confirmacao` → `reuniao_confirmada` (novo) / mantém
  `encerrado_*` para desfechos sem match.
- `reuniao`: `{ marcado_por_uid, marcado_em, avistamento_id, conversa_id, confirmado_por_uid,
  confirmado_em, confirmacao_unilateral: bool }`.

### Fluxo

```
Tutor marca "reunido" (com match vinculado)
   → status = aguardando_confirmacao
   → notificação p/ a contraparte (avistador): "Confirme que o reencontro aconteceu"
   → contraparte confirma
        → status = reuniao_confirmada
        → lgpd_access_log { tipo: 'pet_encontrado' }
        → alimenta North Star (reuniões confirmadas)
   → timeout 7 dias sem confirmação
        → auto-confirma com reuniao.confirmacao_unilateral = true
        → lgpd_access_log { tipo: 'pet_encontrado', unilateral: true }
```

### Componentes a implementar

1. **Cliente (`app.js` + `db.js`):**
   - `marcarEncontrado`: se houver match vinculado → setar `aguardando_confirmacao` + criar
     notificação para a contraparte (via `DB.criarNotificacao`, `tipo: 'confirmar_reuniao'`).
     Senão → comportamento atual (unilateral direto).
   - Render da notificação `confirmar_reuniao` com botão "Confirmar reencontro"
     (em `renderNotificacao`, `app.js` ~3590-3690).
   - Handler do botão → `DB.confirmarReuniao(petId, { avistamentoId })`.

2. **Cloud Function agendada (`functions/src/index.ts`):**
   - `import { onSchedule } from 'firebase-functions/v2/scheduler'`.
   - Job diário: busca `pets_perdidos` com `status == 'aguardando_confirmacao'` e
     `reuniao.marcado_em` > 7 dias → seta `reuniao_confirmada` + `confirmacao_unilateral: true`
     + grava `lgpd_access_log`.
   - *Custo:* 1 execução/dia + reads dos pendentes (baixíssimo).

3. **Firestore Rules (`firestore.rules`):**
   - Permitir que a **contraparte** (participante da `conversa`) atualize `status` de
     `aguardando_confirmacao` → `reuniao_confirmada` e os campos `reuniao.confirmado_*`,
     **sem** poder alterar outros campos. Isso é uma regra nova e **precisa de testes no
     emulator** (dono / contraparte / terceiro).

4. **i18n (3 locales):** `notif.confirm_reunion_title`, `notif.confirm_reunion_btn`,
   `toast.reunion_confirmed`, `toast.awaiting_confirmation`, etc.

5. **Métricas:** North Star = contagem de `status == 'reuniao_confirmada'`. Atualizar
   `painel-efetividade` / dashboard admin para distinguir confirmadas (bilateral) de unilaterais.

### Por que precisa de teste antes do deploy

- Muda a semântica de "encontrado" (pode afetar telas "Meus Reportes", histórias de sucesso,
  contadores).
- Adiciona regra de escrita cruzada (contraparte altera doc do tutor) — **exige** validação no
  Rules emulator para não reabrir um vetor parecido com S-01/S-02.
- Adiciona Cloud Function agendada (precisa deploy + verificação de execução).

---

## Decisões (registradas 2026-06-12)

1. **Ordem da Fase 2:** ✅ **Confirmação bilateral primeiro** (North Star), assim que o
   emulator/sandbox estiver disponível para validar a regra de escrita cruzada.
2. **Bilateral — pets sem match:** ✅ **Unilateral quando não há match/conversa vinculada**
   (como hoje). Bilateral só quando existe avistamento/`conversa` vinculado.
3. **Identidade canônica do destinatário** (afeta otimização #4): *pendente* — decidir se
   mantemos `destinatario_uid` + `destinatario_firebase_uid` ou padronizamos em um só.

### Próximo passo de execução

Implementar a confirmação bilateral como um change set completo **com testes de Rules emulator**
(cliente + CF agendada + rules + i18n), validar localmente e só então fazer deploy. Pré-requisito:
sandbox/emulator disponível (estava fora do ar na sessão de 2026-06-12).

> Assim que o sandbox/emulator estiver disponível (ou você topar validar localmente), implemento
> os itens estruturais com os testes de rules exigidos pelo critério de aceite global.

---

## Checklist Fase 2

- [x] Consistência UI (threshold/raio) — já resolvida via `app-config.js`.
- [x] i18n da notificação de match (`ai-match.js` + 3 locales).
- [ ] Cache TTL no feed (1.1) — baixo risco.
- [ ] Feed via `get()` + refresh (1.2).
- [ ] Paginação com cursor (1.3).
- [ ] Unificar listeners de notificação (1.4) — depende de decisão #1.
- [ ] Cache de perfil/alertas vistos (1.5).
- [ ] Confirmação bilateral de reunião (cliente + CF agendada + rules + i18n) — precisa emulator.
