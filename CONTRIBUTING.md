# 🤝 Guia de Contribuição — Encontre Pet

Obrigado por querer contribuir com o Encontre Pet! 🐾  
Cada contribuição ajuda mais pets a serem encontrados.

---

## 📋 Antes de Começar

1. Leia o [README.md](README.md) para entender o projeto
2. Leia a [Política de Segurança](SECURITY.md)
3. Verifique as [issues abertas](https://github.com/seu-usuario/encontre-pet/issues)

---

## 🚀 Como Contribuir

### 1. Reportar Bugs

Abra uma [issue](https://github.com/seu-usuario/encontre-pet/issues/new?template=bug_report.md) com:
- **Descrição clara** do problema
- **Passos para reproduzir**
- **Comportamento esperado** vs. atual
- **Screenshots** (se aplicável)
- **Dispositivo/navegador** usado

### 2. Sugerir Funcionalidades

Abra uma [issue](https://github.com/seu-usuario/encontre-pet/issues/new?template=feature_request.md) com:
- **Descrição** da funcionalidade
- **Problema** que ela resolve
- **Alternativas** consideradas

### 3. Enviar Código

#### Setup do Ambiente

```bash
# 1. Fork o repositório
# 2. Clone seu fork
git clone https://github.com/SEU-USUARIO/encontre-pet.git
cd encontre-pet

# 3. Crie uma branch
git checkout -b feature/minha-funcionalidade

# 4. Abra index.html no navegador para testar
# (não precisa de build — é 100% estático)
```

#### Estrutura do Projeto

```
encontre-pet/
├── index.html              # App principal (SPA)
├── manifest.json           # PWA manifest
├── sw.js                   # Service Worker
├── css/
│   └── style.css           # Estilos (sem preprocessor)
├── js/
│   ├── firebase-config.js  # Config Firebase/Firestore
│   ├── security.js         # Segurança, hashing, sanitização
│   ├── auth.js             # Autenticação local
│   ├── db.js               # Camada de dados (Firestore + REST)
│   ├── image-utils.js      # Compressão de imagem
│   ├── geo-utils.js        # Geolocalização
│   ├── ai-match.js         # Matching de pets (algoritmo)
│   ├── ai-vision.js        # IA visual (MobileNet)
│   └── app.js              # App principal (UI + navegação)
├── icons/                  # Ícones PWA
├── docs/                   # Documentação extra
│   └── ARCHITECTURE.md     # Arquitetura detalhada
├── SECURITY.md             # Política de segurança
├── PRIVACY.md              # Política de privacidade (LGPD)
├── CONTRIBUTING.md         # Este arquivo
├── CHANGELOG.md            # Histórico de versões
└── LICENSE                 # MIT License
```

#### Padrões de Código

- **JavaScript**: ES6+ (const/let, arrow functions, async/await)
- **CSS**: Variáveis CSS, BEM-like naming
- **HTML**: Semântico (section, article, nav, etc.)
- **Sem build tools**: O projeto é 100% estático, sem webpack/vite/etc.
- **Sem npm**: Todas as dependências via CDN

#### Regras Obrigatórias

1. **Toda entrada de usuário** deve passar por `Security.sanitize()`
2. **Localização real** nunca é exibida — usar `Security.obfuscateLocation()`
3. **Senhas** devem usar `Security.createPasswordHash()` (nunca texto plano)
4. **Dados públicos** devem passar por `Security.sanitizeForPublic()`
5. **Rate limiting** em qualquer ação de criação/autenticação
6. **Comentários em português** no código

#### Checklist do PR

- [ ] Código funciona localmente (abrir index.html no navegador)
- [ ] Sem erros no console do navegador
- [ ] Inputs sanitizados com `Security.sanitize()`
- [ ] Localização ofuscada para views públicas
- [ ] Rate limiting em ações sensíveis
- [ ] Responsivo (mobile-first)
- [ ] Acessível (alt text, ARIA, contraste)
- [ ] Comentários no código

---

## 🏗️ Arquitetura

### Fluxo de Dados

```
Usuário ──► App.js (UI) ──► DB.js (dados) ──► Firestore
                │                                  │
                │ Security.js                      │ Fallback
                │ (sanitize, hash, obfuscate)      ▼
                │                              REST API
                ▼
            Auth.js (sessão local)
```

### Módulos

| Módulo | Responsabilidade | Dependências |
|--------|-----------------|-------------|
| `security.js` | Hash, sanitização, rate limit | Nenhuma (Web Crypto API) |
| `auth.js` | Login, registro, sessão | `security.js`, `firebase-config.js` |
| `db.js` | CRUD, dados de pets | `security.js`, `auth.js`, `geo-utils.js` |
| `app.js` | UI, navegação, formulários | Todos os acima |
| `image-utils.js` | Compressão de imagens | Nenhuma |
| `geo-utils.js` | GPS, geocoding | Nenhuma |
| `ai-vision.js` | Análise de fotos | TensorFlow.js, MobileNet |
| `ai-match.js` | Matching de pets | Nenhuma |

---

## 🧪 Testes

Atualmente não há testes automatizados. Para testar manualmente:

1. Abrir `index.html` no navegador
2. Verificar console (F12) — sem erros
3. Testar fluxos:
   - Registrar conta
   - Fazer login
   - Reportar pet perdido (foto + localização + telefone)
   - Reportar avistamento
   - Verificar matching de IA
   - Verificar mapa
   - Verificar perfil e configurações
   - Testar offline (desconectar rede)

**Contribuição desejada**: Implementar testes com Playwright ou Cypress.

---

## 📜 Licença

Ao contribuir, você concorda que suas contribuições serão licenciadas sob a [MIT License](LICENSE).

---

Obrigado por ajudar pets perdidos a voltarem para casa! 🐾❤️
