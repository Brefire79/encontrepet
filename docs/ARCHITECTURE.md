# 🏗️ Arquitetura do Sistema — Encontre Pet

## Visão Geral

O Encontre Pet é um **Progressive Web App (PWA)** 100% client-side, sem servidor backend. Toda a lógica roda no navegador do usuário.

```
┌─────────────────────────────────────────────────────────┐
│                    NAVEGADOR DO USUÁRIO                   │
│                                                           │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌─────────┐ │
│  │ App.js  │──│ Auth.js  │──│ Security  │──│ DB.js   │ │
│  │  (UI)   │  │ (sessão) │  │  (hash,   │  │ (CRUD)  │ │
│  │         │  │          │  │  sanitize)│  │         │ │
│  └────┬────┘  └──────────┘  └───────────┘  └────┬────┘ │
│       │                                          │       │
│  ┌────┴──────────┐  ┌────────────┐         ┌────┴────┐ │
│  │ ImageUtils.js │  │ GeoUtils   │         │Firestore│ │
│  │ (compressão)  │  │ (GPS, geo) │         │  SDK    │ │
│  └───────────────┘  └────────────┘         └────┬────┘ │
│                                                  │       │
│  ┌────────────────┐  ┌─────────────┐             │       │
│  │ AIVision.js    │  │ AIMatch.js  │             │       │
│  │ (MobileNet)    │  │ (matching)  │             │       │
│  └────────────────┘  └─────────────┘             │       │
│                                                  │       │
│  ┌────────────────────────────────────┐          │       │
│  │ Service Worker (sw.js)             │          │       │
│  │ Cache First (assets)               │          │       │
│  │ Network First (API/Firestore)      │          │       │
│  └────────────────────────────────────┘          │       │
└──────────────────────────────────────────────────┼───────┘
                                                   │
                    ┌──────────────────────────────┼───────┐
                    │          GOOGLE CLOUD         │       │
                    │                               ▼       │
                    │  ┌─────────────────────────────────┐  │
                    │  │     Cloud Firestore              │  │
                    │  │                                   │  │
                    │  │  Collections:                     │  │
                    │  │  ├── pets_perdidos                │  │
                    │  │  ├── avistamentos                 │  │
                    │  │  ├── notificacoes                 │  │
                    │  │  └── usuarios                     │  │
                    │  └─────────────────────────────────┘  │
                    └───────────────────────────────────────┘
```

---

## Módulos e Responsabilidades

### 1. `security.js` — Camada de Segurança

**Sem dependências externas** — usa apenas Web Crypto API nativa.

```
Entrada do usuário
       │
       ▼
┌──────────────┐
│  sanitize()  │──► Remove HTML, <script>, javascript:, on*=
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│ sanitizePhone()  │──► Aceita apenas dígitos e formatação
│ sanitizeEmail()  │──► Aceita apenas chars válidos
│ sanitizeObject() │──► Recursivo para objetos
└──────────────────┘
```

**Hashing de Senha:**
```
password + salt ──► SHA-256 ──► SHA-256 ──► hash hex
                     (1º)        (2º)
                                  │
Armazenado como: "salt:hash"   ◄─┘
```

**Ofuscação de Localização:**
```
GPS (lat, lng) ──► Ângulo aleatório (0°-360°)
                   Distância aleatória (0-500m, distribuição √)
                   ──► (lat ± δlat, lng ± δlng)
                        Truncado 4 casas decimais
                        Nº da rua removido
```

### 2. `auth.js` — Autenticação

Autenticação **100% local** (sem Firebase Auth):

```
Registro:
  email + senha ──► validação ──► checkDuplicate ──► createPasswordHash
                                                          │
  Firestore ◄── createUser(uid, data) ◄──── generateUID ◄┘
       │                                        │
       └── Backup REST (silencioso)              └── saveSession(token 64 chars)

Login:
  email + senha ──► rate limit ──► findByEmail ──► verifyPassword
                     5/min              │                │
                                        │          ┌─────┘
                                        ▼          ▼
                                   user found?  senha ok?
                                   └── yes ──► saveSession ──► notifyListeners
```

### 3. `db.js` — Camada de Dados

Estratégia **dual-mode** com fallback automático:

```
Operação CRUD
     │
     ├── Firestore disponível?
     │   ├── SIM ──► Firestore ──► Backup REST (silencioso)
     │   └── NÃO ──┐
     │              │
     ├── REST disponível?
     │   ├── SIM ──► REST API
     │   └── NÃO ──┐
     │              │
     └── Fila local (localStorage)
         └── Sync quando conexão voltar
```

**Collections:**

| Collection | Campos Principais |
|-----------|-------------------|
| `pets_perdidos` | tipo_animal, foto_comprimida, lat/lng, owner_uid, status |
| `avistamentos` | tipo_animal, foto_comprimida, lat/lng, pet_perdido_id |
| `notificacoes` | tipo, pet_id, mensagem, lida |
| `usuarios` | nome, email, senha_hash, config_* |

### 4. `app.js` — Interface e Navegação

SPA (Single Page Application) com navegação por hash:

```
index.html (container único)
     │
     ├── page-home (feed de alertas)
     ├── page-reportar-rapido (formulário passo 1)
     ├── page-cadastro-completo (formulário passo 2)
     ├── page-avistamento (reportar avistamento)
     ├── page-mapa (visualização geográfica)
     ├── page-perfil (configurações)
     ├── page-notificacoes (lista)
     ├── page-meus-reportes (histórico)
     ├── page-pet-details (detalhe do pet)
     ├── page-como-funciona (tutorial)
     ├── page-privacidade (LGPD)
     ├── page-patrocinadores (apoiadores)
     └── page-sobre (créditos)
```

### 5. `image-utils.js` — Processamento de Imagens

```
File (câmera/galeria)
     │
     ├── readFileAsDataURL ──► 15%
     ├── loadImage (decode) ──► 30%
     ├── resizeAndCompress  ──► 55% (máx 800px, JPEG 0.65)
     ├── thumbnail          ──► 70% (200px, JPEG 0.5)
     ├── perceptualHash     ──► 85% (dHash 16×16 = 256 bits)
     ├── dominantColors     ──► 95% (top 3 cores)
     └── DONE               ──► 100%

Tempo médio: 300-800ms (com progresso real em tempo real)
```

### 6. `ai-vision.js` + `ai-match.js` — Inteligência Artificial

```
Foto do pet ──► MobileNet (TensorFlow.js)
                    │
                    ├── Classificação (raça, tipo)
                    ├── Embedding (vetor 1024 dims)
                    └── Confidence (0-100%)

Matching:
  Embedding do avistamento ──► Similaridade coseno ──► com cada pet perdido
                                                            │
  + tipo_animal match (peso 30%)                            │
  + cor match (peso 20%)                                    │
  + proximidade (peso 25%)                                  │
  + hash visual (peso 25%)                                  │
                                                            ▼
                                                      Score 0-100%
                                                      > 70% = match alto
                                                      > 40% = match possível
```

### 7. `sw.js` — Service Worker

```
Requisição
     │
     ├── É API/Firestore? ──► NETWORK FIRST
     │                         ├── Rede OK ──► Cache resposta + retornar
     │                         └── Rede FAIL ──► Buscar no cache
     │
     └── É asset estático? ──► CACHE FIRST
                                ├── Cache hit ──► Retornar (instantâneo)
                                └── Cache miss ──► Fetch + cache
```

---

## Modelo de Dados

### Pet Perdido

```json
{
  "id": "auto_generated",
  "tipo_animal": "cao | gato | outro",
  "subtipo_animal": "Ave | Coelho | ...",
  "nome_pet": "Rex",
  "raca": "Labrador",
  "cor": "caramelo",
  "porte": "medio",
  "foto_comprimida": "data:image/jpeg;base64,...",
  "foto_hash": "a3f2c891...",
  "embedding": [0.12, -0.34, ...],
  "latitude": -23.5505,
  "longitude": -46.6333,
  "latitude_publica": -23.5540,
  "longitude_publica": -46.6291,
  "endereco": "Rua Augusta, 123",
  "endereco_publico": "Rua Augusta, Consolação",
  "localizacao_aproximada": true,
  "descricao": "Fugiu durante temporal",
  "contato_telefone": "11999887766",
  "contato_email": "joao@email.com",
  "tem_recompensa": true,
  "recompensa": "R$ 500",
  "status": "ativo | encontrado",
  "owner_uid": "u_abc123",
  "raio_busca_km": 5,
  "created_at": "2026-02-17T...",
  "updated_at": "2026-02-17T..."
}
```

---

## Fluxo de Segurança

```
                    ┌─────────────────────────┐
                    │  DADOS DO USUÁRIO        │
                    │  (nome, email, senha,    │
                    │   telefone, localização) │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  SANITIZAÇÃO             │
                    │  sanitize() em strings   │
                    │  sanitizePhone()         │
                    │  sanitizeEmail()         │
                    │  validateReportData()    │
                    └────────────┬────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                   │
    ┌─────────▼──────┐ ┌────────▼─────┐  ┌─────────▼──────┐
    │ SENHA          │ │ LOCALIZAÇÃO  │  │ CONTATO        │
    │ createPassword │ │ obfuscate    │  │ maskPhone()    │
    │ Hash()         │ │ Location()   │  │ maskEmail()    │
    │ salt:SHA256²   │ │ ±500m        │  │ ****-**XX      │
    └────────┬───────┘ └──────┬───────┘  └────────┬───────┘
             │                │                    │
    ┌────────▼────────────────▼────────────────────▼───────┐
    │              ARMAZENAMENTO (Firestore)                 │
    │  senha_hash: "abc123:def456..."                       │
    │  latitude_publica: -23.5540 (ofuscada)                │
    │  contato_telefone: "11999887766" (original, privado)  │
    └───────────────────────┬───────────────────────────────┘
                            │
                    ┌───────▼───────┐
                    │ EXIBIÇÃO      │
                    │ PÚBLICA       │
                    │ sanitizeFor   │
                    │ Public()      │
                    │ remove:       │
                    │ - telefone    │
                    │ - email       │
                    │ - lat/lng     │
                    │ - owner_uid   │
                    │ - senha_hash  │
                    │ - embedding   │
                    └───────────────┘
```

---

*Documento gerado em 17/02/2026 — Encontre Pet v1.0.0*
