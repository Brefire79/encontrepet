# ESTADO_ATUAL.md — Auditoria do estado real (Fase 0)

> **Data:** 2026-06-12
> **Escopo:** Mapeamento somente-leitura do código em produção vs. documentação (`AUDIT.md` v2026-03-21).
> **Conclusão principal:** A **Regra de Ouro se confirma** — o app está **bem mais maduro que o `AUDIT.md`**. 9 dos 11 achados de segurança já estão corrigidos no código. As duas inconsistências de UI (threshold 92% e raio 2 km) **já não existem** — foram resolvidas via fonte única de verdade (`js/app-config.js`).
> **Observação técnica desta sessão:** o sandbox Linux (emulador) e a busca por glob na pasta OneDrive não estavam disponíveis; a auditoria foi feita por leitura direta + grep arquivo a arquivo. Os testes do Firestore Rules emulator ficam para a Fase 1.

---

## 1. Inventário de features funcionais (estado real)

| Feature | Estado | Evidência |
|---|---|---|
| Autenticação própria (REST + Firebase Auth UID duplo `u_xxx`) | ✅ Funcional | `js/auth.js`, `index.html` (login/cadastro/recuperar senha) |
| Reporte rápido de pet perdido (2 passos) + recompensa | ✅ Funcional | `index.html` `#page-reportar-rapido` / `#page-cadastro-completo`; `db.js` ~409 |
| Avistamento com foto + opt-in de telefone | ✅ Funcional | `index.html` `#page-avistamento`; `db.js` |
| Compressão de imagem client-side antes do upload | ✅ Funcional | `js/image-utils.js` (injetado em `index.html`) |
| Matching IA client-side (MobileNet/TF.js, lazy-load) | ✅ Funcional | `js/ai-vision.js`, `js/ai-match.js`, `js/services/image-hash.js`, `js/services/similarity.js` |
| Feed de proximidade por espécie | ✅ Funcional | `db.js` listeners `limit(200)`; raio por `AppConfig.getSearchRadius()` |
| Mapa de alertas | ✅ Funcional | `index.html` `#page-mapa` |
| Chat interno tutor↔avistador | ✅ Funcional | `firestore.rules` `match /conversas/{}` + subcoleção `mensagens`; CF cria `conversaId={petId}_{avistamentoId}` (`functions/src/index.ts` ~395) |
| Detector de duplicatas/fraude (hash + distância geo) | ✅ Funcional | `index.html` `#duplicate-case-modal`; `js/components/ModalDuplicateCase.js` |
| Painel admin (dashboard + moderação) | ✅ Funcional | `index.html` `#admin-master-section`; `firestore.rules` `admin_roles` |
| Revelação de contato via Cloud Function LGPD | ✅ Funcional | `functions/src/index.ts` `getTutorContact` (~552) |
| Match bilateral automático (notifica os dois lados + cria chat) | ✅ Funcional | CF trigger `onAvistamentoCreate` em `avistamentos/{}` (`index.ts` ~340-520) |
| Fechamento de alerta com tipos de desfecho | ✅ Funcional (mas **unilateral**) | `app.js` `goToFeedbackStep2` ~4140; desfechos `encontrado_vivo`/`encontrado_morto`/`desistencia`; `DB.marcarEncontrado` ~4239 |
| Pesquisa pós-reunião / feedback | ✅ Funcional | `app.js` modal de feedback ~4140-4239 |
| i18n PT/EN/ES | ✅ Funcional | `js/i18n/locales/{pt,en,es}.js` + `js/i18n.js` |
| Log de auditoria LGPD | ✅ Funcional | coleção `lgpd_access_log` (rules create-only; CF grava vários `tipo`) |

**Confirmação bilateral de reunião (North Star):** **NÃO implementada.** O fechamento atual é unilateral (`marcarEncontrado` grava `desfecho` direto). A CF possui `match_confirmado` (confirmação de *match*, não de *reunião*). Item da Fase 2.

---

## 2. Divergência de thresholds (70% vs 92%) — **JÁ RESOLVIDA**

**Fonte única de verdade:** `js/app-config.js`
```js
MATCH_THRESHOLD: 70,
HASH_MATCH_THRESHOLD: 70,
```

| Local | Valor usado | Evidência |
|---|---|---|
| Engine de match | `MATCH_THRESHOLD` (70), fallback 70 | `js/ai-match.js` 10-18, 168-175 |
| Mensagem de match | 70 | `js/ai-match.js` 235-237 |
| Tela "Como Funciona" | **dinâmico** `${PT_MATCH_THRESHOLD}%+` → exibe 70% | `pt.js` 316 (`how.step4.desc`) |
| EN/ES "Como Funciona" | sem número fixo (usa raios no step3) | `en.js`/`es.js` 314 |

**Não foi encontrado nenhum "92%" hardcoded** em `app.js`, `ai-match.js`, `similarity.js` nem nos locales. A reclamação do `AUDIT.md`/prompt ("tela exibe 92%") está **desatualizada**.

**Semântica padronizada (estado atual):**
- **70%** = threshold único de sugestão E de revelação. Não existe gatilho separado de 92%.
- **Decisão pendente para você (Fase 1/2):** manter 70% como gatilho único, **ou** reintroduzir ≥92% como "alta confiança para revelação mútua automática" (como o `AUDIT.md` descreve). Hoje a CF `getTutorContact` exige avistamento vinculado **ou** score ≥70% (`index.ts` ~603-604), e a CF bilateral usa um flag `isHighMatch`. **Preciso da sua decisão antes de mexer.**

---

## 3. Divergência de raios (0,8 km vs 2 km) — **JÁ RESOLVIDA**

**Fonte única de verdade:** `js/app-config.js`
```js
SEARCH_RADIUS_KM = { cao: 5, gato: 0.8, outro: 3 }
```

Todos os pontos de exibição **leem do `AppConfig`** dinamicamente (gato = 0,8 km consistente):
- `pt.js`/`en.js`/`es.js` linha 4 (`*_RADIUS`), 81-85 (cards home), 115-117 (radio cards), 156 (`report.note`), 314 (`how.step3.desc`).
- `db.js` usa `raio_busca_km` calculado a partir do tipo.

**Não foi encontrado "2 km" em lugar algum** do código/locales. A divergência citada está **desatualizada**. Nada a corrigir.

---

## 4. Estado do i18n (PT/EN/ES)

**Paridade estrutural alta.** As três línguas têm os mesmos blocos nas mesmas linhas (chat, detalhes, raios, etc.). Chaves auditadas:

| Chave | PT | EN | ES |
|---|---|---|---|
| `chat.*` (title, open, loading, empty, placeholder, send, send_error, unavailable) | ✅ 284-291 | ✅ 284-291 | ✅ 284-291 |
| `details.email_tutor` | ✅ 257 | ✅ 257 | ✅ 257 |
| `details.tutor_no_phone` | ✅ 258 | ✅ 258 | ✅ 258 |
| `details.whatsapp_msg` | ✅ 260 | ✅ 260 | ✅ 260 |
| `sighting.match_high_contact_sent` | ✅ 206 | ✅ 206 | ✅ 206 |
| `audit.contact_access` | ❌ ausente | ❌ ausente | ❌ ausente |
| `audit.match_high` | ❌ ausente | ❌ ausente | ❌ ausente |

**Conclusão i18n:**
- As 3 chaves "novas" críticas do `AUDIT.md` (`email_tutor`, `tutor_no_phone`, `whatsapp_msg`) **já existem nos 3 idiomas**.
- As 2 chaves `audit.contact_access` / `audit.match_high` **não existem** — mas **também não são referenciadas no código** (o app usa `sighting.match_high_contact_sent`). São opcionais; criar só se formos exibir esses textos.
- **Nova lacuna i18n encontrada (não estava no AUDIT):** `js/ai-match.js` 235-237 monta a mensagem de notificação de match **hardcoded em PT** (`"🎉 Possível match encontrado! ..."`). Idem CF `index.ts` ~421 (`"Novo avistamento de ... registrado"`) — mas CF é server-side, prioridade menor. Sugiro mover a string do `ai-match.js` para i18n na Fase 2.

> Observação: uma verificação 100% definitiva de paridade exige diff linha a linha com o emulador/script, que ficou indisponível nesta sessão. A amostragem indica paridade completa para tudo que é exibido ao usuário.

---

## 5. Estado de cada achado S-01 a S-11

| # | Sev | Estado | Evidência |
|---|---|---|---|
| **S-01** alert_privado aberto | 🔴 | ✅ **CORRIGIDO** | `firestore.rules` 85-99: `get` só dono, `list:if false`. Fallback direto removido — `app.js` 2923 só chama `getPrivateAlertData` dentro de `if (isOwner)`. |
| **S-02** notificacoes cruzadas | 🔴 | ✅ **CORRIGIDO** | `firestore.rules` 193-203 (read/update/delete só destinatário). `db.js` `criarNotificacao` 940-958 preenche `destinatario_uid`/`destinatario_firebase_uid`. |
| **S-03** senha_hash exposto | 🟠 | ✅ **CORRIGIDO** | `firestore.rules` 241-243 `senhas_usuarios` `read,write:if false`; CF `saveUserPassword`/`verifyUserPassword` (`index.ts` ~740+). **Verificar na migração**: docs `usuarios` legados podem ainda conter `senha_hash`. |
| **S-04** fallback sem log LGPD | 🟠 | ✅ **CORRIGIDO** | Fallback p/ não-donos eliminado (S-01); `getTutorContact` grava `lgpd_access_log` (`index.ts` ~684-699). |
| **S-05** contato sem avistamento | 🟡 | ✅ **CORRIGIDO** | `index.ts` 594-613: exige avistamento vinculado **ou** score ≥70% antes de revelar. |
| **S-06** contato_email público | 🟡 | ✅ **CORRIGIDO** | `db.js` 409-453: doc público só tem `contato_email_publico` (opt-in) + `email_publico_ativo`; e-mail completo vai p/ `alert_privado` (462). |
| **S-07** rate limit client-side | 🟡 | ✅ **CORRIGIDO** | `security.js` 405-420: persistido em `localStorage`. CF tem rate limit server-side (`index.ts` 537-543). |
| **S-08** owner_firebase_uid público | 🟡 | ❌ **PENDENTE** | `db.js` 450 grava `owner_firebase_uid` no doc público; `app.js` 2596/2852/3098 leem dele. Precisa migrar p/ usar só `owner_uid` em público. |
| **S-09** 3 strings hardcoded PT | 🔵 | ✅ **CORRIGIDO** | Nenhuma das 3 strings encontrada em `app.js`; substituídas por `I18n.t()`. (Ver nova lacuna em §4 — `ai-match.js`.) |
| **S-10** WhatsApp hardcoded | 🔵 | ✅ **CORRIGIDO** | `app.js` 3392 usa `I18n.t('details.whatsapp_msg', { name })`. |
| **S-11** isOwner inconsistente | 🔵 | ⚠️ **PARCIAL/PENDENTE** | Rules já aceitam ambos (`isOwner()` 8-13). Cliente ainda checa só `owner_uid`: `app.js` 2914 `pet.owner_uid === Auth.getUID()`. Falta adicionar `|| owner_firebase_uid === getFirebaseUID()` (a função `getFirebaseUID` já existe). |

**Resumo:** 9/11 corrigidos. **Pendentes reais: S-08 (médio) e S-11 (baixo/parcial).**

---

## 6. Custo estimado por operação crítica (Firestore/CF) e oportunidades

> Estimativas em leituras/escritas por operação; cotas free-tier Blaze (50k reads, 20k writes/dia).

| Operação | Custo atual | Observação |
|---|---|---|
| Carga do feed (home) | até **~400 reads** + atualizações em tempo real | `db.js` usa `onSnapshot` com `limit(200)` p/ `pets_perdidos` e `limit(200)` p/ `avistamentos` (~1376-1436). O listener mantém custo recorrente enquanto a tela está aberta. |
| Notificações | **2 listeners `onSnapshot`** simultâneos | `db.js` 1297-1311: um por `destinatario_firebase_uid`, outro por `destinatario_uid`. Duplica reads p/ cobrir mismatch de UID. |
| Revelação de contato (`getTutorContact`) | **1 invocação CF + ~3-4 reads** | pet doc + alert_privado + query de avistamento vinculado (`index.ts` 594-626). |
| Avistamento criado (`onAvistamentoCreate`) | **1 invocação CF + vários reads/writes** | lê pet + dados privados, grava logs LGPD, cria conversa, cria notificações (`index.ts` 340-520). |

**Oportunidades de redução (Fase 2):**
1. **Feed sem realtime:** trocar `onSnapshot` por `get()` + cache (TTL) no feed — o feed não exige tempo real. Reduz reads recorrentes.
2. **Paginação real:** `limit` + cursor (`startAfter`) em vez de `limit(200)` fixo; carregar mais sob demanda.
3. **Unificar listeners de notificação:** consolidar `owner_uid` e `owner_firebase_uid` no mesmo campo/consulta para cair de 2 listeners → 1.
4. **Cache local (localStorage/IndexedDB) com TTL** para perfil e alertas já vistos (dados pouco voláteis).
5. **Consolidar campos lidos juntos** no mesmo documento para reduzir reads cruzados.

---

## Decisões que preciso de você antes da Fase 1

1. **Threshold:** manter **70% como gatilho único** (estado atual) ou **reintroduzir ≥92%** como camada de "alta confiança → revelação mútua automática"? Isso muda a CF e a doc.
2. **S-03 migração:** rodo o script idempotente para remover `senha_hash` de docs `usuarios` legados? (sem commitar service account)
3. **S-08 migração:** removo `owner_firebase_uid` dos docs públicos `pets_perdidos`/`avistamentos`? (requer migração + ajuste de leitura no client)
4. **Ordem da Fase 1:** ataco S-08 e S-11 (únicos pendentes de segurança) + as migrações S-03/S-06/S-08, ou prefere ir direto para a Fase 2 (custo/otimização) já que a segurança crítica está fechada?

**Aguardando sua confirmação para iniciar a Fase 1.** Nada de código foi alterado nesta fase.
