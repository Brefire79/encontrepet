# Auditoria de Segurança — Encontre Pet v1.0.0

> **Data:** 2026-03-21
> **Versão auditada:** db2ec51 (branch `main`)
> **Escopo:** Segurança de dados, exposição de informações, fluxo de revelação de contato, cobertura multilíngue
> **Autor:** Análise automatizada + revisão manual

---

## Sumário Executivo

O app possui uma base de segurança sólida: ofuscação de localização (±500 m), hashing de senhas com SHA-256 + salt, sanitização XSS, rate limiting e separação de dados privados via coleção `alert_privado`. Porém foram identificadas **4 vulnerabilidades críticas/altas** que precisam de correção imediata, além de melhorias no fluxo de revelação de contato e lacunas de internacionalização.

---

## Índice de Achados

| # | Severidade | Componente | Título |
|---|-----------|------------|--------|
| S-01 | 🔴 CRÍTICO | `firestore.rules` | `alert_privado` lido por qualquer usuário autenticado (inclusive anônimo) |
| S-02 | 🔴 CRÍTICO | `firestore.rules` | `notificacoes` sem restrição de proprietário — leitura cruzada |
| S-03 | 🟠 ALTO | `firestore.rules` | `usuarios` listável por qualquer autenticado — expõe `senha_hash` |
| S-04 | 🟠 ALTO | `app.js` | Fallback de contato sem log LGPD — acesso privado sem rastreamento |
| S-05 | 🟡 MÉDIO | `app.js` | Revelação de contato sem verificação de match/avistamento vinculado |
| S-06 | 🟡 MÉDIO | `app.js` + `firestore.rules` | `contato_email` armazenado no documento público `pets_perdidos` |
| S-07 | 🟡 MÉDIO | `security.js` | Rate limiting apenas client-side — resetável com reload de página |
| S-08 | 🟡 MÉDIO | `app.js` | `owner_firebase_uid` exposto em documentos públicos |
| S-09 | 🔵 BAIXO | `app.js` | 3 strings hardcoded em PT-BR — não passam pelo sistema i18n |
| S-10 | 🔵 BAIXO | `app.js` | Mensagem WhatsApp hardcoded em português |
| S-11 | 🔵 BAIXO | `auth.js` | ID customizado `u_xxx` ≠ Firebase Auth UID — verificação de owner inconsistente |

---

## Achados Detalhados

---

### S-01 🔴 CRÍTICO — `alert_privado`: leitura aberta para qualquer usuário autenticado

**Arquivo:** `firestore.rules` linha 74
**Impacto:** Qualquer usuário anônimo (Firebase Auth automático) que conheça o `alertId` de um pet pode ler dados privados como `contato_telefone`, `contato_email` e `contato_nome` do tutor.

**Código problemático:**
```firestore
match /alert_privado/{docId} {
  allow get: if isSignedIn();  // ← QUALQUER anônimo, não só o dono
  ...
}
```

**Por que é crítico:** O `docId` segue o padrão `pets_perdidos_{alertId}`, sendo o `alertId` publicamente visível em todos os alertas do feed. Logo qualquer visitante anônimo pode construir o caminho e ler dados privados de todos os tutores.

**Correção:**
```firestore
match /alert_privado/{docId} {
  // Dono pode ler seus próprios dados
  allow get: if isSignedIn() && (
    resource.data.owner_firebase_uid == request.auth.uid ||
    resource.data.owner_uid == request.auth.uid
  );
  allow list: if false;
  // Criação e atualização: apenas o dono
  allow create: if isSignedIn() && (
    request.resource.data.owner_firebase_uid == request.auth.uid ||
    request.resource.data.owner_uid == request.auth.uid
  );
  allow update: if isSignedIn() && (
    resource.data.owner_firebase_uid == request.auth.uid ||
    resource.data.owner_uid == request.auth.uid
  );
  allow delete: if isSignedIn() && (
    resource.data.owner_firebase_uid == request.auth.uid ||
    resource.data.owner_uid == request.auth.uid
  );
}
```

> ⚠️ Esta correção invalida o fallback direto em `app.js` (`getTutorContact` linha 2572). O fallback deve ser removido — a Cloud Function `getTutorContact` deve ser o **único** meio de não-donos acessarem contatos privados.

---

### S-02 🔴 CRÍTICO — `notificacoes`: leitura/escrita cruzada entre usuários

**Arquivo:** `firestore.rules` linha 127
**Impacto:** Qualquer usuário autenticado lê e escreve notificações de qualquer outro usuário.

**Código problemático:**
```firestore
match /notificacoes/{docId} {
  allow read, write: if isSignedIn();  // ← SEM filtro de dono
}
```

**Cenário de ataque:** Usuário A chama `db.collection('notificacoes').get()` e obtém todas as notificações de todos os usuários do app, incluindo informações sobre matches de pets e solicitações de contato.

**Correção:**
```firestore
match /notificacoes/{docId} {
  // Leitura: apenas o destinatário ou o dono
  allow read: if isSignedIn() && (
    resource.data.destinatario_uid == request.auth.uid ||
    resource.data.owner_firebase_uid == request.auth.uid ||
    resource.data.owner_uid == request.auth.uid
  );
  // Escrita: qualquer autenticado pode criar (sistema envia notificações)
  allow create: if isSignedIn();
  // Update/delete: apenas o destinatário
  allow update, delete: if isSignedIn() && (
    resource.data.destinatario_uid == request.auth.uid ||
    resource.data.owner_firebase_uid == request.auth.uid
  );
}
```

> ⚠️ Para esta regra funcionar, todas as notificações precisam ter `destinatario_uid` ou `owner_firebase_uid` preenchidos. Verificar `DB.criarNotificacao()` no código.

---

### S-03 🟠 ALTO — `usuarios`: listagem expõe `senha_hash` de todos os usuários

**Arquivo:** `firestore.rules` linha 106
**Impacto:** Qualquer usuário autenticado executa `db.collection('usuarios').get()` e obtém o hash SHA-256 + salt de senha de todos os usuários cadastrados.

**Código problemático:**
```firestore
match /usuarios/{uid} {
  allow list: if isSignedIn();  // ← Retorna todos os docs com senha_hash
  ...
}
```

**Contexto:** O `allow list` é necessário para a busca de usuário por email no login (`fsFindByEmail`). Porém retorna o documento inteiro incluindo `senha_hash`.

**Mitigação imediata:** Remover `senha_hash` do documento principal de usuário e movê-lo para uma subcoleção `usuarios/{uid}/credentials` com acesso `if false` para clientes. O hash de verificação de senha deve ser operado apenas por Cloud Functions.

**Alternativa de curto prazo (sem Cloud Functions):** Usar uma query com `select` não é suportado em Firestore rules. A solução é mover `senha_hash` para uma coleção separada `senhas_usuarios/{uid}` com `allow read, write: if false` — apenas admin SDK acessa.

---

### S-04 🟠 ALTO — Fallback de contato sem log LGPD

**Arquivo:** `js/app.js` linhas 2572–2594
**Impacto:** Quando a Cloud Function falha, o app lê `alert_privado` diretamente sem registrar o acesso na coleção `lgpd_access_log`. O log de auditoria LGPD é bypassado.

**Código problemático (app.js ~2572):**
```javascript
// 2. Fallback: leitura direta da coleção alert_privado
const privateData = await DB.getPrivateAlertData('pets_perdidos', petId);
if (privateData) {
  return {
    nome:     privateData.contato_nome     || '',
    telefone: privateData.contato_telefone || '',
    email:    privateData.contato_email    || ''
  };
  // ← NENHUM log de auditoria aqui!
}
```

**A Cloud Function (index.ts) tem o log correto:**
```typescript
await db.collection('lgpd_access_log').add({
  tipo: 'contato_tutor_acesso',
  petId,
  requesterFirebaseUid: requesterUid,
  dadosAcessados: [...],
  timestamp: ...
});
```

**Correção:** Ver S-01 — ao corrigir as Firestore Rules, o fallback se tornará impossível para não-donos. Se o fallback for mantido por necessidade, adicionar `DB.criarNotificacao()` com `tipo: 'contato_acesso_fallback'` antes do `return`.

---

### S-05 🟡 MÉDIO — Contato revelado sem verificação de match ou avistamento vinculado

**Arquivo:** `js/app.js` linha 2469 + `functions/src/index.ts` linha 228
**Impacto:** Qualquer usuário autenticado pode chamar `getTutorContact(petId)` para qualquer pet, sem precisar ter feito um avistamento ou ter um match ≥ 92%. O fluxo ideal exige que apenas:

1. Quem tem um avistamento vinculado ao pet (`avistamentos.pet_perdido_id == petId`), **ou**
2. Quem registrou um avistamento com score ≥ 92%

...possa revelar o contato.

**Fluxo atual:**
```
Usuário vê alerta → Clica "Ver contato" → Contato revelado imediatamente
```

**Fluxo ideal:**
```
Usuário vê alerta → Registra avistamento → Sistema verifica match →
Se score ≥ 92% → Contato revelado automaticamente (ambos os lados)
Se score < 92% → Botão "Solicitar contato" disponível após avistamento
```

**Correção na Cloud Function (`getTutorContact`):** Verificar se existe um avistamento vinculado:
```typescript
// Verificar se o solicitante tem avistamento vinculado
const sightingSnap = await db.collection('avistamentos')
  .where('owner_firebase_uid', '==', requesterUid)
  .where('pet_perdido_id', '==', petId)
  .limit(1)
  .get();

const hasSighting = !sightingSnap.empty;
const matchScore = sightingSnap.docs[0]?.data()?.match_score || 0;

if (!hasSighting) {
  throw new HttpsError('permission-denied',
    'Registre um avistamento antes de solicitar o contato do tutor.');
}
```

---

### S-06 🟡 MÉDIO — `contato_email` armazenado no documento público

**Arquivo:** `js/app.js` linha 1831
**Impacto:** O email do tutor é salvo diretamente no documento `pets_perdidos`, que tem `allow read: if true`. Mesmo com mascaramento no frontend, o dado completo é lido pelo cliente.

**Código problemático:**
```javascript
contato_email: Auth.getUserData()?.email || '',  // ← Vai para pets_perdidos (público!)
```

**Correção:** Remover `contato_email` do documento público. Apenas `email_publico_ativo: true/false` e `contato_email_publico` (email escolhido para divulgação) devem existir no documento público. O email completo deve estar apenas em `alert_privado`.

---

### S-07 🟡 MÉDIO — Rate limiting apenas client-side

**Arquivo:** `js/security.js` linha 387
**Impacto:** `checkRateLimit()` usa um objeto em memória (`rateLimits = {}`). Recarregar a página (F5) zera todos os contadores. Um atacante pode executar 5 tentativas de login, recarregar, repetir indefinidamente — brute force de senhas sem bloqueio real.

**O que existe de proteção server-side:** Apenas a Cloud Function `getTutorContact` tem rate limiting real. Login e registro não têm.

**Recomendação:** Implementar rate limiting com timestamp no `localStorage` (persiste o reload) como mitigação de curto prazo. A solução definitiva é um Cloud Function para validação de login.

**Mitigação imediata em `security.js`:**
```javascript
function checkRateLimit(action, maxAttempts = 5, windowMs = 60000) {
  const key = `ratelimit_${action}`;
  const now = Date.now();
  let attempts = [];
  try {
    attempts = JSON.parse(localStorage.getItem(key) || '[]');
  } catch { attempts = []; }
  attempts = attempts.filter(t => now - t < windowMs);
  if (attempts.length >= maxAttempts) {
    const waitTime = Math.ceil((windowMs - (now - attempts[0])) / 1000);
    throw new Error(`Muitas tentativas. Aguarde ${waitTime} segundos.`);
  }
  attempts.push(now);
  localStorage.setItem(key, JSON.stringify(attempts));
  return true;
}
```

---

### S-08 🟡 MÉDIO — `owner_firebase_uid` exposto em documentos públicos

**Arquivo:** `js/app.js` + Firestore collections `pets_perdidos`, `avistamentos`
**Impacto:** O Firebase Auth UID (`owner_firebase_uid`) é armazenado em documentos públicos. Embora não seja uma senha, UIDs do Firebase são identificadores permanentes que podem ser correlacionados entre serviços. Permite enumerar todos os alertas de um usuário específico.

**Recomendação:** Usar apenas `owner_uid` (ID customizado `u_xxx`) nos documentos públicos. Manter `owner_firebase_uid` apenas no documento `alert_privado` para uso interno das Firestore Rules.

---

### S-09 🔵 BAIXO — Strings hardcoded em PT-BR (não i18n)

**Arquivo:** `js/app.js`
**Impacto:** Usuários com idioma EN ou ES verão texto em português nestes pontos críticos do fluxo de contato.

| Linha | String hardcoded | Chave i18n sugerida |
|-------|-----------------|---------------------|
| 2409 | `"Encontrou este pet? Entre em contato com o tutor!"` | `details.found_this_pet` (já existe em pt.js) |
| 2414 | `"Enviar E-mail ao Tutor"` | `details.email_tutor` (nova chave) |
| 2524 | `'Tutor encontrado mas sem telefone cadastrado.'` | `details.tutor_no_phone` (nova chave) |

---

### S-10 🔵 BAIXO — Mensagem WhatsApp hardcoded em português

**Arquivo:** `js/app.js` linha 2601
**Impacto:** A mensagem pré-preenchida do WhatsApp é sempre em português, independente do idioma configurado.

**Código atual:**
```javascript
window.open(`https://wa.me/${br}?text=${encodeURIComponent(`Olá! Vi no Encontre Pet sobre "${name}". Tenho informações!`)}`, '_blank');
```

**Correção:** Usar `I18n.t('details.whatsapp_msg', { name })`.

---

### S-11 🔵 BAIXO — Verificação de `isOwner` usa ID inconsistente

**Arquivo:** `js/app.js` linha 2295
**Impacto:** A verificação de owner no cliente usa o ID customizado `u_xxx`, mas as Firestore Rules usam o Firebase Auth UID. Se a sincronização entre os dois falhar, o usuário pode ver a UI de dono sem ter as permissões das rules (ou vice-versa).

**Código problemático:**
```javascript
const isOwner = !!(pet.owner_uid && pet.owner_uid === Auth.getUID()); // u_xxx
```

**Recomendação:** Adicionar verificação dupla: `owner_uid == Auth.getUID() || owner_firebase_uid == Auth.getFirebaseUID()`.

---

## Análise do Fluxo de Revelação de Contato

### Fluxo atual (como está)

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLUXO ATUAL (INSEGURO)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Qualquer usuário autenticado                                    │
│         │                                                        │
│         ▼                                                        │
│  Vê alerta de pet perdido                                        │
│         │                                                        │
│         ▼                                                        │
│  Clica "Ver contato do tutor"  ←── SEM verificação de match    │
│         │                                                        │
│         ├──▶ [Cloud Function] getTutorContact                   │
│         │         │                                              │
│         │         ├─ ✅ Rate limit (5/min)                      │
│         │         ├─ ✅ Log LGPD em lgpd_access_log            │
│         │         └─ ✅ Respeita email_publico_ativo            │
│         │                                                        │
│         └──▶ [FALLBACK] Leitura direta alert_privado  ← ⚠️     │
│                   │                                              │
│                   ├─ ❌ Sem log LGPD                            │
│                   ├─ ❌ alert_privado lido por anônimos         │
│                   └─ ❌ Sem verificação de avistamento          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Fluxo ideal (como deve ser)

```
┌─────────────────────────────────────────────────────────────────┐
│                   FLUXO IDEAL (SEGURO)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Usuário vê alerta de pet perdido                               │
│         │                                                        │
│         ▼                                                        │
│  Registra avistamento  (obrigatório para acessar contato)       │
│         │                                                        │
│         ▼                                                        │
│  Sistema calcula match score                                     │
│         │                                                        │
│         ├─ Score ≥ 92% ──▶ Notificação automática para ambos   │
│         │                   │                                    │
│         │                   ├─ Tutor recebe: "Avistamento com   │
│         │                   │   alta compatibilidade!"          │
│         │                   │                                    │
│         │                   └─ Avistador recebe contato do      │
│         │                       tutor automaticamente           │
│         │                                                        │
│         └─ Score < 92% ──▶ Botão "Solicitar contato"           │
│                             disponível após avistamento         │
│                             com log LGPD obrigatório            │
│                                                                  │
│  [Cloud Function] getTutorContact (ÚNICA via para não-donos)    │
│         ├─ ✅ Verifica avistamento vinculado                    │
│         ├─ ✅ Rate limit server-side                            │
│         ├─ ✅ Log LGPD em lgpd_access_log                      │
│         ├─ ✅ Respeita email_publico_ativo e tel_publico_ativo  │
│         └─ ✅ Notifica tutor do acesso                          │
│                                                                  │
│  [Firestore] alert_privado                                       │
│         └─ ✅ Apenas o dono pode ler diretamente               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Revelação de contato entre tutor e avistador (match ≥ 92%)

Quando há match de alta compatibilidade, **ambos os lados** devem receber o contato do outro de forma segura e com consentimento:

| Quem | O que recebe | Condição |
|------|-------------|----------|
| **Avistador** | Telefone/email do tutor (se `telefone_publico_ativo: true` ou `email_publico_ativo: true`) | Ter registrado avistamento vinculado |
| **Tutor** | Telefone do avistador (se `telefone_publico_ativo: true` no avistamento) | Match automático ≥ 92% |
| **Ambos** | Notificação no app com botões de contato | Score ≥ 92% |

O campo `contato` no documento `avistamentos` deve seguir a mesma lógica de privacidade: apenas expor se `telefone_publico_ativo: true` no avistamento.

---

## Análise de Cobertura Multilíngue

### Status atual

| Locale | Arquivo | Chaves | Cobertura |
|--------|---------|--------|-----------|
| PT-BR | `js/i18n/locales/pt.js` | ~150+ | ✅ Referência |
| EN | `js/i18n/locales/en.js` | ~150+ | ✅ Paridade estimada |
| ES | `js/i18n/locales/es.js` | ~150+ | ✅ Paridade estimada |

### Chaves faltantes identificadas

Estas chaves não existem em nenhum locale e precisam ser adicionadas:

| Chave | PT-BR | EN | ES |
|-------|-------|----|----|
| `details.email_tutor` | "Enviar E-mail ao Tutor" | "Send Email to Owner" | "Enviar Email al Dueño" |
| `details.tutor_no_phone` | "Tutor encontrado mas sem telefone cadastrado." | "Owner found but no phone registered." | "Dueño encontrado pero sin teléfono registrado." |
| `details.whatsapp_msg` | "Olá! Vi no Encontre Pet sobre \"{name}\". Tenho informações!" | "Hi! I saw the Encontre Pet alert about \"{name}\". I have information!" | "¡Hola! Vi la alerta de Encontre Pet sobre \"{name}\". ¡Tengo información!" |
| `audit.contact_access` | "Acesso ao contato registrado" | "Contact access logged" | "Acceso al contacto registrado" |
| `audit.match_high` | "Match de alta compatibilidade detectado" | "High compatibility match detected" | "Match de alta compatibilidad detectado" |

### Strings hardcoded encontradas em app.js (não i18n)

```javascript
// Linha 2409 — usar I18n.t('details.found_this_pet') (chave já existe em pt.js)
<span>Encontrou este pet? Entre em contato com o tutor!</span>

// Linha 2414 — usar I18n.t('details.email_tutor') (nova chave)
<i class="fas fa-envelope"></i> Enviar E-mail ao Tutor

// Linha 2524 — usar I18n.t('details.tutor_no_phone') (nova chave)
showToast('Tutor encontrado mas sem telefone cadastrado.', 'warning');

// Linha 2601 — usar I18n.t('details.whatsapp_msg', { name }) (nova chave)
`Olá! Vi no Encontre Pet sobre "${name}". Tenho informações!`
```

---

## Checklist de Correções Prioritárias

### Imediato (antes do próximo deploy)

- [ ] **S-01** — Corrigir `firestore.rules`: `alert_privado` → `allow get: if isSignedIn() && isOwner(resource.data)`
- [ ] **S-02** — Corrigir `firestore.rules`: `notificacoes` → adicionar filtro `destinatario_uid == request.auth.uid`
- [ ] **S-04** — Remover fallback direto de `alert_privado` em `app.js` para não-donos (ou adicionar log LGPD)
- [ ] **S-09** — Substituir 3 strings hardcoded PT por chamadas `I18n.t()`

### Curto prazo (próxima sprint)

- [ ] **S-03** — Mover `senha_hash` para coleção `senhas_usuarios/{uid}` com `allow: false`
- [ ] **S-05** — Cloud Function `getTutorContact`: verificar avistamento vinculado antes de revelar contato
- [ ] **S-06** — Remover `contato_email` do documento público `pets_perdidos`
- [ ] **S-07** — Persistir rate limiting no `localStorage` (sobrevive reloads)
- [ ] **S-10** — Internacionalizar mensagem WhatsApp

### Médio prazo

- [ ] **S-08** — Remover `owner_firebase_uid` de documentos públicos
- [ ] **S-11** — Unificar verificação `isOwner` no cliente com Firebase Auth UID
- [ ] Implementar fluxo de revelação mútua de contato para matches ≥ 92%
- [ ] Adicionar notificação ao tutor quando alguém acessa seu contato
- [ ] Dashboard de auditoria LGPD para o tutor (quem acessou, quando)

---

## Coleções Firestore — Matriz de Acesso Esperada

| Coleção | Leitura pública | Leitura autenticado | Escrita | Notas |
|---------|----------------|--------------------|---------|-|
| `pets_perdidos` | ✅ Todos | ✅ Todos | Apenas dono | Não incluir email/tel privados |
| `avistamentos` | ✅ Todos | ✅ Todos | Apenas dono | Contato apenas se `tel_publico_ativo` |
| `alert_privado` | ❌ | ✅ Apenas dono | Apenas dono | Não-donos: via Cloud Function |
| `usuarios` | ❌ | ✅ Apenas o próprio uid | Apenas o próprio uid | `senha_hash` em coleção separada |
| `notificacoes` | ❌ | ✅ Apenas destinatário | Qualquer autenticado | Requer `destinatario_uid` |
| `lgpd_access_log` | ❌ | ❌ | ❌ (apenas admin SDK) | Log de auditoria LGPD |
| `senhas_usuarios` | ❌ | ❌ | ❌ (apenas admin SDK) | Recomendado (novo) |

---

## Log de Auditoria LGPD — Eventos a Registrar

A coleção `lgpd_access_log` deve registrar todos os eventos abaixo:

| Evento | `tipo` | Dados registrados |
|--------|--------|-------------------|
| Contato tutor acessado via CF | `contato_tutor_cf` | petId, requesterUid, campos, timestamp, ip |
| Contato tutor acessado via fallback | `contato_tutor_fallback` | petId, requesterUid, timestamp |
| Match ≥ 92% detectado | `match_alto` | petId, avistamentoId, score, engine, timestamp |
| Notificação de contato enviada | `notif_contato` | petId, de, para, timestamp |
| Usuário solicita exclusão de dados | `exclusao_dados` | userId, timestamp |
| Alerta marcado como encontrado | `pet_encontrado` | petId, userId, timestamp |

---

## Histórico de Auditorias

| Data | Versão | Auditor | Severidades encontradas |
|------|--------|---------|------------------------|
| 2026-02-17 | Pre-audit | SECURITY.md | Baseline |
| 2026-03-21 | db2ec51 | Análise automatizada | 2 Crítico, 2 Alto, 4 Médio, 3 Baixo |
