# PRD — Encontre Pet v2.0
### PWA comunitário para reunir pets perdidos com seus tutores

> **Autor:** Breno — Vianexx AI
> **Data:** 2026-05-30
> **Status:** **Em produção (v1.0.0)** · proposta de evolução para v2.0
> **Produção:** https://encontre-pet.netlify.app/
> **Stack:** Vanilla JS · Firebase/Firestore · Cloud Functions (TS) · Netlify · Capacitor · i18n (PT-BR/EN/ES)
> **Baseline de segurança:** `AUDIT.md` (achados S-01 a S-11)

---

## 1. Visão e missão

**Missão:** reunir o maior número possível de pets perdidos com seus tutores, usando avistamentos colaborativos da comunidade e correspondência por imagem (AI), com **custo operacional próximo de zero** e **conformidade LGPD por padrão**.

**Métrica-norte (North Star):** **número de reuniões confirmadas** (pet marcado como "reencontrado" após contato real entre tutor e avistador). Todo o pipeline técnico existe para suportar esse desfecho humano de ponta a ponta.

**Princípios inegociáveis:**
1. **Custo-zero primeiro** — toda decisão arquitetural prioriza permanecer dentro dos limites gratuitos. Solução que gera custo em escala é deprioritizada ou movida para o cliente.
2. **Recall > precisão** — limiar de match em **70%** para favorecer mais conexões, aceitando alguns falsos positivos (decisão de produto já tomada).
3. **LGPD embutida** — privacidade e auditoria são requisito de implementação, não item posterior.
4. **Comunidade como motor** — o alcance e a confiança vêm da rede de pessoas da região, não de mídia paga.

---

## 2. Problema

Pets se perdem e a janela de reencontro é curta. Os caminhos atuais (grupos de WhatsApp, posts isolados em redes sociais, cartazes) são fragmentados, sem correspondência automática e sem proteção de dados de contato. O **Encontre Pet** centraliza alertas, cruza avistamentos por imagem e conecta as duas pontas — mas só entrega valor real se a conexão tutor↔avistador acontecer de forma rápida, segura e até a confirmação da reunião.

---

## 3. Personas

| Persona | Objetivo | Dores |
|---|---|---|
| **Tutor (perdeu o pet)** | Recuperar o pet rápido; ser avisado de avistamentos compatíveis | Medo de expor telefone/endereço; ansiedade; não saber se o avistamento é confiável |
| **Avistador (viu um pet)** | Ajudar; avisar o dono certo sem burocracia | Não saber de quem é o pet; não querer expor o próprio número |
| **Apoiador da comunidade** | Compartilhar alertas, aumentar alcance local | Falta de incentivo/feedback; alertas desatualizados poluindo o feed |
| **Patrocinador** | Associar a marca a uma causa local e ganhar visibilidade | Falta de métrica de impacto; medo de causa "morna" |
| **Operador/admin (você)** | App estável, barato e em conformidade | Custos imprevistos do Firebase; risco LGPD; moderação manual |

---

## 4. Estado atual — o que JÁ está em produção (v1.0.0)

Verificado no app ao vivo. Boa parte do que seria "v2.0" já existe; o trabalho restante é mais **endurecimento** do que construção.

**✅ Já entregue e em produção:**
- Reporte rápido (perdi/vi um pet) com foto, localização e marcadores (cor, porte, espécie).
- **Compressão de imagem 100% no dispositivo** antes do upload (valida a estratégia custo-zero — não enviamos originais).
- **AI de matching rodando 100% no navegador** (sem Vision/Vertex pagos).
- Login opcional, inclusive **"continuar sem conta"** (anônimo).
- Ofuscação de localização (±500 m, configurável) e mascaramento de contato público.
- Mapa de alertas / feed por proximidade (perdido, avistado, você).
- Chat interno (Fase 2) por `matchId`.
- Notificações no app.
- **Fase 3 parcialmente entregue:** encerramento de reporte com desfecho (encontrado vivo / faleceu / encerrar busca) **e pesquisa pós-reunião** ("o app ajudou?", nota 1–5, "como aconteceu?").
- Detector de duplicata/fraude (distância de hash + distância geográfica, marcar como suspeito, vincular ao caso, abrir chat).
- Painel administrativo com métricas.
- **Monetização por patrocínio** já desenhada (Bronze/Prata/Ouro).
- Multilíngue PT/EN/ES com seletor de idioma.

**⚠️ Inconsistências visíveis (dívida de string/i18n a corrigir):**
- A tela "Como Funciona" ainda diz **"92%+ de similaridade"**, mas a decisão de produto é **70%** → string desatualizada passando informação errada.
- Raios divergem entre telas: home mostra **gato 0,8 km**, "Como Funciona" diz **2 km**. Mesma causa (valores hardcoded em pontos diferentes).

**⏳ Pendências reais (foco da v2.0):**
- Achados de segurança do `AUDIT.md` (S-01 a S-11) — invisíveis na UI, mas reais.
- Paridade i18n EN/ES das chaves novas e fim das strings hardcoded.
- Confirmação **bilateral** de reunião (hoje o encerramento parece unilateral pelo tutor).
- Reteste E2E do fluxo completo entre duas contas.

---

## 5. Objetivos da v2.0 e métricas

| Objetivo | Métrica | Meta |
|---|---|---|
| Aumentar reuniões reais | Reuniões confirmadas / matches gerados | ≥ 25% |
| Fechar brechas de segurança | Achados críticos/altos do AUDIT resolvidos | 100% (S-01 a S-08) |
| Manter custo-zero | Custo mensal Firebase | **R$ 0** dentro do free tier |
| Cobertura de idioma | Chaves i18n com paridade PT/EN/ES | 100% |
| Consistência de UI | Strings com valores divergentes (limiar, raios) | 0 |
| Confiança no match | Taxa de falso positivo reportada pelo usuário | Monitorada e < 30% |
| Engajamento comunitário | Avistamentos por alerta ativo | ≥ 1,5 |
| Sustentabilidade | Patrocinadores ativos cobrindo custo Blaze | ≥ 1 |

---

## 6. Estratégia de custo-zero (núcleo do PRD)

Firebase tem dois planos: **Spark** (grátis, sem cartão) e **Blaze** (pay-as-you-go, exige conta de faturamento). O ponto crítico: **Cloud Functions exigem o plano Blaze**, mesmo que as 2M invocações/mês sejam gratuitas. O Blaze inclui todas as cotas gratuitas do Spark e só cobra acima delas.

### 6.1 Limites gratuitos relevantes (free tier 2026 — confirmar no console)

| Recurso | Cota grátis | Implicação para o Encontre Pet |
|---|---|---|
| Firestore leituras | ~50.000/dia | Cuidar de listeners e leituras redundantes no feed |
| Firestore escritas | ~20.000/dia | Lote/throttle em notificações e logs |
| Firestore storage | ~1 GiB | Documentos enxutos; nada de blobs |
| Cloud Functions | 2M invocações/mês | Minimizar invocações; só onde é indispensável |
| Cloud Storage (imagens) | ~5 GB | Compressão client-side **já implementada** |
| Hosting Firebase transfer | ~360 MB/dia | Front **já está no Netlify**, não no Hosting |
| FCM (push) | Ilimitado e grátis | Usar à vontade para notificações |
| Auth | ~10k–50k MAU | Suficiente para escala comunitária |

> Fontes de pricing variam e mudam; tratar os números como referência e validar no Firebase Console + billing alerts.

### 6.2 Decisões de arquitetura para ficar no zero

1. **Hosting no Netlify (free), não no Firebase Hosting.** ✅ Já adotado.
2. **AI de imagem 100% client-side.** ✅ Já em produção ("análise roda no navegador"). Manter; evitar qualquer migração para Vision/Vertex.
3. **Compressão de imagem no upload.** ✅ Já em produção. Conferir parâmetros (lado máx ~1024px, qualidade ~0.7, WebP/JPEG) para maximizar economia de Storage.
4. **Cloud Functions só onde é indispensável** — basicamente `getTutorContact` (revelação de contato com log LGPD + rate limit server-side) e o gatilho de match. Todo o resto vai para Firestore Rules + cliente.
5. **Blaze com trava de orçamento:** ativar o Blaze (necessário para Functions), mas configurar **billing alert e budget em valor baixo (ex.: R$ 1)** e quota de invocações, para que custo > 0 dispare alerta imediato.
6. **Economia de leitura:** paginar o feed, usar `limit()`, cache local (IndexedDB) de alertas já vistos, e desligar listeners ao sair da tela.
7. **Logs e notificações em lote/throttle** para não estourar as 20k escritas/dia.

### 6.3 Plano B se o Blaze for indesejável
Substituir as Functions por (a) regras Firestore mais rígidas + lógica no cliente, com log LGPD client-side de integridade reduzida, ou (b) function gratuita externa só para o endpoint de contato. **Recomendação:** manter Blaze com trava de orçamento — melhor equilíbrio entre custo-zero real e segurança.

---

## 7. Sustentabilidade financeira (patrocínio)

O app já tem um modelo de receita comunitária desenhado, que existe para **cobrir o custo eventual do Blaze** sem comprometer o "100% gratuito" para o usuário final.

| Plano | Preço | Benefícios |
|---|---|---|
| 🥉 Bronze | R$ 49/mês | Logo na seção de parceiros · menção nas redes · 1 cupom/mês |
| 🥈 Prata | R$ 99/mês | Bronze + banner no app · 3 cupons/mês · notificação regional |
| 🥇 Ouro | R$ 199/mês | Prata + selo "Apoiador Oficial" · cupons ilimitados · destaque na home · relatório de impacto |

**Diretrizes:**
- Manter a promessa "sem anúncios" — patrocínio é presença de marca/cupom, não rede de anúncios.
- A notificação regional patrocinada deve respeitar opt-in e não competir com alertas de pet (prioridade sempre do alerta).
- **Um único patrocinador Prata já cobre com folga qualquer custo realista de Blaze** no estágio atual — meta mínima de sustentabilidade.
- Relatório de impacto do plano Ouro pode reusar as métricas do painel admin (reuniões, alcance).

---

## 8. Requisitos funcionais

### 8.1 Já entregue — manter e endurecer
- RF-01 Notificação bilateral automática em match (limiar **70%** — corrigir textos que dizem 92%).
- RF-02 Chat interno por `matchId` com tempo real e regras por participante.
- RF-03 Compressão de imagem client-side. ✅
- RF-04 AI de matching client-side. ✅
- RF-05 Detector de duplicata/fraude. ✅

### 8.2 Fase 3 — Confirmação de reunião (auditar e completar)
Boa parte já existe (encerramento + pesquisa). O que falta endurecer:
- **RF-10** Confirmação **bilateral**: a reunião só vira "confirmada" quando tutor **e** avistador confirmam (ou tutor confirma e indica quem ajudou). Hoje o encerramento parece unilateral.
- **RF-11** Ao confirmar: disparar evento LGPD `pet_encontrado`, notificação de agradecimento e janela de reversão de X horas (correção de engano).
- **RF-12** Garantir que a pesquisa pós-reunião ("o app ajudou?") alimente a North Star e a taxa de falso positivo de forma agregada e barata.

### 8.3 Segurança — fechar o AUDIT (ver §10)
- **RF-20** Revelação de contato apenas via Cloud Function, com avistamento vinculado obrigatório (S-05).
- **RF-21** Regras Firestore corrigidas para `alert_privado`, `notificacoes`, `usuarios` (S-01/02/03).
- **RF-22** Remover dados privados (`contato_email`, `owner_firebase_uid`) de documentos públicos (S-06/08).

### 8.4 Consistência de conteúdo (novo — prioridade rápida)
- **RF-25** Centralizar limiar de match e raios por espécie em **uma única fonte de verdade** (config), e referenciar via i18n. Eliminar "92%" e os raios divergentes (0,8 km vs 2 km).

### 8.5 Comunidade — incrementos (baixo custo)
- **RF-30** Feed por proximidade já existe; refinar agrupamento por bairro/cidade sem API de mapa paga.
- **RF-31** Compartilhamento com Open Graph por alerta (gerado no Netlify) para espalhar em WhatsApp/Instagram.
- **RF-32** Reconhecimento do avistador: contador agregado de "avistamentos úteis"/"reuniões ajudadas" no perfil.
- **RF-33** Reativar/atualizar alerta: lembrete periódico ao tutor para manter o feed limpo.
- **RF-34** Moderação leve apoiada no detector de duplicata/fraude já existente.

### 8.6 Confiabilidade do match
- **RF-40** Mostrar score + marcadores no card de match para o humano julgar.
- **RF-41** Feedback "não é meu pet" → ajusta ranking e alimenta a métrica de falso positivo.

---

## 9. Requisitos não-funcionais

- **RNF-01 LGPD:** acesso a contato privado registrado em `lgpd_access_log` (só admin SDK escreve). Dashboard de auditoria para o tutor — médio prazo.
- **RNF-02 Segurança:** rate limit server-side no endpoint sensível; client-side persistido em `localStorage` (S-07).
- **RNF-03 i18n:** PT-BR/EN/ES com paridade total; zero strings hardcoded no fluxo de contato (S-09/10).
- **RNF-04 Performance/offline:** PWA com cache de assets, feed paginado, listeners desligados fora da tela.
- **RNF-05 Acessibilidade:** contraste AA, navegação por teclado, alvos de toque ≥ 44px.
- **RNF-06 Observabilidade de custo:** billing alert + budget baixo no Blaze; painel de uso de leituras/escritas.

---

## 10. Backlog de segurança priorizado (do AUDIT.md)

### Imediato (antes do próximo deploy)
- [ ] **S-01** `alert_privado` → `allow get` só para o dono; não-donos via Cloud Function. *(Crítico: "continuar sem conta" = anônimo autenticado já consegue ler hoje.)*
- [ ] **S-02** `notificacoes` → filtrar por `destinatario_uid`/`owner_firebase_uid`.
- [ ] **S-04** Remover fallback direto de `alert_privado` em `app.js` (ou exigir log LGPD).
- [ ] **S-09** Trocar strings PT hardcoded por `I18n.t()`.
- [ ] **RF-25** Corrigir "92%" → 70% e unificar raios.

### Curto prazo
- [ ] **S-03** Mover `senha_hash` para `senhas_usuarios/{uid}` com `allow: false`.
- [ ] **S-05** `getTutorContact`: exigir avistamento vinculado.
- [ ] **S-06** Tirar `contato_email` do documento público.
- [ ] **S-07** Persistir rate limit em `localStorage`.
- [ ] **S-10** Internacionalizar mensagem do WhatsApp.

### Médio prazo
- [ ] **S-08** Remover `owner_firebase_uid` dos documentos públicos.
- [ ] **S-11** Unificar verificação `isOwner`.
- [ ] Dashboard de auditoria LGPD para o tutor.

---

## 11. Roadmap sugerido (recalibrado)

| Sprint | Foco | Entregáveis |
|---|---|---|
| **S1 — Blindagem** | Segurança imediata + consistência | S-01/02/04/09 · RF-25 (92%→70%, raios) · billing alert no Blaze |
| **S2 — Reunião** | Endurecer Fase 3 | RF-10 (confirmação bilateral) · RF-11 (evento LGPD + reversão) · RF-12 |
| **S3 — Confiança & i18n** | S-05/06/07/10 · paridade EN/ES · RF-40/41 |
| **S4 — Comunidade & receita** | Open Graph (RF-31) · reconhecimento (RF-32) · refinar moderação (RF-34) · página de patrocínio com métricas de impacto |
| **S5 — Polimento** | S-08/11 · dashboard LGPD do tutor · reteste E2E entre duas contas |

---

## 12. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Estourar free tier do Firestore | Custo inesperado | Paginação, cache local, listeners controlados, billing alert baixo |
| Blaze exigir cartão | Atrito/risco de cobrança | Budget R$1 + quota; receita de patrocínio cobre o custo |
| Falsos positivos com limiar 70% | Falsa esperança | Score + marcadores; feedback "não é meu pet"; nunca revelar contato sem avistamento |
| Textos inconsistentes (92%/raios) | Confiança do usuário | RF-25: fonte única de verdade + i18n |
| Vazamento de contato (brechas AUDIT) | LGPD/confiança | Backlog S-01..S-08 com prioridade máxima (app já em produção) |

---

## 13. Fora de escopo (v2.0)
- Mapas com API paga (Google Maps billing) — usar agrupamento por bairro.
- AI server-side (Vision/Vertex).
- App nativo além do wrapper Capacitor existente.

---

## 14. Matriz de acesso Firestore (alvo)

| Coleção | Leitura pública | Leitura autenticado | Escrita |
|---|---|---|---|
| `pets_perdidos` | ✅ | ✅ | só dono · sem dados privados |
| `avistamentos` | ✅ | ✅ | só dono · contato só se `tel_publico_ativo` |
| `alert_privado` | ❌ | só dono | só dono · não-donos via Function |
| `usuarios` | ❌ | só o próprio uid | só o próprio uid |
| `senhas_usuarios` | ❌ | ❌ | ❌ (admin SDK) |
| `notificacoes` | ❌ | só destinatário | qualquer autenticado (cria) |
| `conversas/{matchId}/mensagens` | ❌ | só participantes | só participantes |
| `lgpd_access_log` | ❌ | ❌ | ❌ (admin SDK) |
