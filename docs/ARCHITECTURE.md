# 🏗️ Arquitetura do Sistema — Encontre Pet

> Atualizado em 2026-09-29 (v1.21.x). Em caso de divergência, o código e `firestore.rules` valem mais que este texto. Segurança canônica: `AUDIT.md`.

## Visão Geral

O Encontre Pet é um **PWA client-side (Vanilla JS, sem bundler)** que fala direto com o **Firestore** (protegido por `firestore.rules`) e chama um **backend mínimo em Netlify Functions** (Admin SDK) para tudo que exige privilégio: contato de tutor (LGPD), senha, notificações/push e varreduras agendadas.

- **Custo zero:** projeto Firebase `encontre-pet-137d2` em **Spark** (sem Cloud Functions, sem Storage). Hospedagem e backend no **Netlify**.
- **IA no navegador:** matching por imagem (MobileNet + hash perceptual) roda no cliente; nenhuma chamada paga.
- `functions/` (Cloud Functions TS) é **só referência histórica**; o backend real é `netlify/functions/`.

```
┌──────────────────────── NAVEGADOR / PWA ────────────────────────┐
│ app.js (UI) ─ auth.js ─ security.js ─ db.js ─ i18n.js           │
│ image-utils · geo-utils · ai-vision · ai-match · similarity     │
│ services/backend.js (shim httpsCallable → Netlify Functions)    │
│ services/push.js (FCM)      sw.js (cache + push)                │
└───────┬───────────────────────────────┬─────────────────────────┘
        │ Firestore SDK (rules)         │ POST /.netlify/functions/<nome>
        │ Firebase Auth                 │ Bearer <ID token>
        ▼                               ▼
┌────────────────────┐        ┌──────────────────────────────────┐
│ Firebase (Spark)   │◄───────│ Netlify Functions (Admin SDK)    │
│ Firestore · Auth · │        │ callable: contato, senha, login, │
│ FCM                │        │ push-token, notificações         │
└────────────────────┘        │ agendadas: sweep (6h), auto-     │
                              │ confirmar reuniões (diária)      │
                              └──────────────────────────────────┘
```

---

## Módulos e Responsabilidades

### 1. `security.js` — Sanitização e privacidade
- Web Crypto nativa. `sanitize()`, `sanitizePhone()`, `sanitizeEmail()`, `sanitizeObject()`, `validateReportData()`.
- Rate limiting no cliente (localStorage) — apoio de UX; o limite que vale está nas Functions (`checkRateLimit`).
- **Ofuscação de localização:** GPS → ângulo/distância aleatórios (0–500 m, √), truncado a 4 casas; nº da rua removido. Só a versão ofuscada vai para o doc público.
- Hash de senha **não fica mais no cliente/Firestore público** — ver Auth.

### 2. `auth.js` — Autenticação e identidade dupla
- **Firebase Auth** (REST) + login com Google.
- **Identidade dupla:** ID customizado `u_xxx` (`owner_uid`) **e** Firebase UID (`owner_firebase_uid`). Ownership deve aceitar ambos (cliente e rules). S-08 está migrando o Firebase UID para `alert_privado`, saindo do doc público.
- Senha: `save-user-password` / `verify-user-password` / `login-user` (Functions) gravam em `senhas_usuarios` (acesso só via Admin). Busca por e-mail via `check-email-exists`/`login-user`, sem listar `usuarios` (N-01).

### 3. `db.js` — Camada de dados
Firestore primeiro; REST e fila local (localStorage) como fallback offline.

| Coleção | Uso |
|---|---|
| `pets_perdidos`, `avistamentos` | Docs **públicos** (campos ofuscados, `foto_thumb`, embedding/hash) |
| `alert_privado` | Contato/endereço exatos e dados de ownership — **só dono** |
| `fotos/{colecao}_{id}` | Foto cheia (sem Storage: `USE_FIREBASE_STORAGE=false`) |
| `vinculos_avistamento`, `sighter_authorizations` | Ligação pet↔avistamento e autorização de contato |
| `lgpd_access_log` | Auditoria de todo acesso a contato de terceiros |
| `usuarios`, `senhas_usuarios` | Perfil (sem senha) / hashes (só backend) |
| `notificacoes` | Avisos in-app (criação validada pelas rules) |
| `conversas/{id}/mensagens` | Chat; `conversaId = matchId = {petId}_{avistamentoId}` |
| `admin_roles` | Papéis administrativos |

### 4. Backend — `netlify/functions/`
Padrão `callable(...)` em `_lib/http.js` (valida ID token, rate limit, erros `HttpsError`). Shim `js/services/backend.js` mantém a assinatura antiga `functions.httpsCallable(...)`.

| Function | Função |
|---|---|
| `get-tutor-contact`, `get-sighter-contact` | Revelam contato **somente** com vínculo/score ≥ limiar; sempre gravam `lgpd_access_log` |
| `process-avistamento` | Substitui o trigger `onAvistamentoCreate`: cria notificação/push de match |
| `notify-tutor-contact`, `push-token` | Notificações e registro de token FCM |
| `save/verify-user-password`, `login-user`, `check-email-exists` | Credenciais e lookup por e-mail |
| `count-users-in-radius` | Contagem de usuários no raio (N-01 impede fazer no cliente) |
| `sweep-avistamentos` (cron 6h) | Rede de segurança do `process-avistamento` |
| `auto-confirmar-reunioes` (cron diário) | North Star: confirma reuniões após 7 dias |

Deploy e variáveis: `docs/DEPLOY_NETLIFY.md`. `netlify.toml` também faz o proxy `/__/auth/*` (login Google) e o catch-all do SPA.

### 5. `app.js` — Interface e navegação
SPA de página única (`index.html`) com páginas: home (feed), reportar rápido/completo, avistamento, mapa, perfil, notificações, meus reportes, detalhes, como funciona, privacidade, patrocinadores, sobre. Textos sempre via `I18n.t` (`pt`/`en`/`es`).

### 6. `image-utils.js` — Imagens
`File → decode → resize (≤800px, JPEG .65) → thumbnail (200px, .5) → dHash 16×16 → cores dominantes`. O feed usa `foto_thumb` (barato); detalhe/match usam a foto cheia de `fotos/`.

### 7. `ai-vision.js` + `ai-match.js` — Matching por IA
MobileNet (TF.js) gera embedding; `services/similarity.js` + `image-hash.js` combinam similaridade visual com espécie, cor e proximidade. **Gatilho único: 70%** (`AppConfig`, nunca hardcoded). **Raios por espécie:** `{ cao: 5, gato: 0.8, outro: 3 }` km em `app-config.js`.

### 8. `sw.js` — Service Worker
- Assets estáticos: cache first. Rede/API: network first.
- **Não intercepta outros domínios nem `/__/auth`** (login Google quebrava — v1.20/1.21).
- Exibe push (FCM) e abre o app no toque.

---

## Modelo de dados (resumo do pet perdido)

Campos **públicos** (`pets_perdidos`): `tipo_animal`, `nome_pet`, `raca`, `cor`, `porte`, `foto_thumb`, `foto_hash`, `embedding`, `latitude_publica`/`longitude_publica` (ofuscadas), `endereco_publico`, `descricao`, `status` (`ativo | encontrado`), `owner_uid`, `raio_busca_km`, timestamps.

Campos **privados** (`alert_privado`, só dono): telefone, e-mail, endereço e coordenadas exatas, `owner_firebase_uid`. Terceiros só obtêm contato via `get-tutor-contact`.

---

## Fluxo de segurança

```
Entrada ─► sanitize*/validateReportData ─► ofusca localização
   │
   ├─ público  ─► pets_perdidos / avistamentos  (sem contato exato, sem senha)
   ├─ privado  ─► alert_privado                 (rules: só dono)
   └─ senha    ─► Function ─► senhas_usuarios   (só Admin SDK)

Não-dono quer contato ─► get-tutor-contact ─► valida vínculo/score
                                            ─► grava lgpd_access_log ─► responde
```

Regras de ouro: nunca expor `alert_privado` a não-donos; testar `firestore.rules` no emulator (anônimo, dono, terceiro) antes de qualquer deploy; matriz esperada em `AUDIT.md`.

---

*Reescrito em 2026-09-29 para refletir a arquitetura pós-Netlify Functions (antes: v1.0.0, 100% client-side).*
