# 🐾 Encontre Pet — PWA v1.0.0

> **App gratuito que ajuda a encontrar pets perdidos usando geolocalização e inteligência artificial.**

[![Netlify Status](https://api.netlify.com/api/v1/badges/placeholder/deploy-status)](https://encontre-pet.netlify.app)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![LGPD](https://img.shields.io/badge/LGPD-Compliant-green.svg)](PRIVACY.md)

🌐 **App ao vivo**: [encontre-pet.netlify.app](https://encontre-pet.netlify.app)

---

## 📖 Sobre

O **Encontre Pet** é um Progressive Web App (PWA) 100% gratuito que conecta pessoas que perderam seus pets com quem os avistou. Usa inteligência artificial no navegador para comparar fotos automaticamente e alerta por proximidade geográfica.

### ❤️ Missão

Ajudar o máximo de pets perdidos a voltarem para casa, de forma gratuita, rápida e acessível para todos.

---

## ✨ Funcionalidades

### 🚨 Reporte Rápido
- Tire ou escolha uma foto (câmera / galeria)
- Compressão ultra-rápida com barra de progresso em tempo real (~500ms)
- Obtenha localização GPS automaticamente
- Dispare alerta em segundos

### 🤖 Inteligência Artificial
- **MobileNet** roda 100% no navegador (sem envio de fotos para servidores)
- Identifica raça e tipo de animal automaticamente
- Compara fotos de pets perdidos com avistamentos
- Score de matching com porcentagem de similaridade

### 📍 Geolocalização Inteligente
- Alertas por proximidade (5km cães, 2km gatos, 3km outros)
- Mapa visual de alertas da região
- **Localização ofuscada** (±500m) — nunca revela endereço exato

### 🔒 Privacidade e Segurança
- Senhas hasheadas (SHA-256 + salt)
- Telefone e email mascarados para outros usuários
- Rate limiting contra abuso
- Sanitização XSS em todas as entradas
- Em conformidade com a **LGPD**

### 📱 PWA Completa
- Instalável em Android, iOS e Desktop
- Funciona offline (Service Worker + cache inteligente)
- Banner de atualização automática
- Responsiva (mobile-first)

### 🐦 Tipos de Animais
- 🐕 Cães | 🐱 Gatos | 🐦 Aves | 🐰 Coelhos | 🐹 Hamsters
- 🐢 Tartarugas | 🐠 Peixes | 🦎 Répteis | Furões | + texto livre

---

## 🖼️ Screenshots

| Home | Reporte | Avistamento |
|------|---------|-------------|
| Feed de alertas por proximidade | Foto + localização + contato | IA compara com pets perdidos |

---

## 🚀 Quick Start

### Usar o App
Acesse [encontre-pet.netlify.app](https://encontre-pet.netlify.app) — funciona direto no navegador.

### Desenvolvimento Local

```bash
# 1. Clone o repositório
git clone https://github.com/seu-usuario/encontre-pet.git
cd encontre-pet

# 2. Abra no navegador (sem build necessário!)
# Opção A: abrir index.html diretamente
open index.html

# Opção B: servidor local (recomendado para Service Worker)
npx serve .
# ou
python3 -m http.server 8080
```

> ⚠️ **O projeto é 100% estático** — sem npm install, sem build, sem webpack.

### Configurar Firebase (opcional)

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com)
2. Ative o Firestore Database
3. Substitua as credenciais em `js/firebase-config.js`
4. Configure as [Security Rules](SECURITY.md#regras-firestore-recomendadas)
5. Adicione seu domínio em Authentication → Authorized domains

---

## 📁 Estrutura do Projeto

```
encontre-pet/
│
├── index.html                 # App principal (SPA — todas as páginas)
├── manifest.json              # PWA manifest
├── sw.js                      # Service Worker v1.0.0
├── .gitignore                 # Arquivos ignorados pelo Git
│
├── css/
│   └── style.css              # Estilos (~3000 linhas, variáveis CSS)
│
├── js/
│   ├── firebase-config.js     # Configuração Firebase/Firestore
│   ├── security.js            # Hashing, sanitização, rate limiting
│   ├── auth.js                # Autenticação local (SHA-256 + sessão)
│   ├── db.js                  # CRUD (Firestore + REST + localStorage)
│   ├── image-utils.js         # Compressão de imagem com progresso
│   ├── geo-utils.js           # Geolocalização e geocoding
│   ├── ai-match.js            # Algoritmo de matching de pets
│   ├── ai-vision.js           # IA visual (MobileNet/TensorFlow.js)
│   └── app.js                 # App principal (UI, navegação, forms)
│
├── icons/                     # Ícones PWA (72px a 512px)
│
├── docs/
│   └── ARCHITECTURE.md        # Arquitetura detalhada do sistema
│
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md      # Template para bugs
│   │   └── feature_request.md # Template para features
│   └── pull_request_template.md
│
├── README.md                  # Este arquivo
├── SECURITY.md                # Política de segurança + auditoria
├── PRIVACY.md                 # Política de privacidade (LGPD)
├── CONTRIBUTING.md            # Guia de contribuição
├── CHANGELOG.md               # Histórico de versões
└── LICENSE                    # MIT License
```

---

## 🛠️ Tecnologias

| Tecnologia | Uso | Versão |
|-----------|-----|--------|
| **HTML5** | Estrutura semântica | — |
| **CSS3** | Estilos, variáveis CSS, animações | — |
| **JavaScript ES6+** | Lógica (sem frameworks) | — |
| **Firebase Firestore** | Banco de dados NoSQL | 10.14.1 |
| **TensorFlow.js** | IA no navegador | 4.21.0 |
| **MobileNet** | Classificação de imagens | 2.1.1 |
| **Web Crypto API** | Hashing SHA-256 | Nativo |
| **Service Worker** | PWA offline | — |
| **Geolocation API** | GPS | Nativo |
| **Canvas API** | Mapa e compressão de imagens | Nativo |
| **Font Awesome** | Ícones | 6.4.0 |
| **Google Fonts** | Tipografia (Nunito) | — |

### Sem dependências de build:
- ❌ Sem Node.js
- ❌ Sem npm/yarn
- ❌ Sem webpack/vite/rollup
- ❌ Sem React/Vue/Angular
- ❌ Sem TypeScript
- ✅ JavaScript puro + CDN

---

## 🔒 Segurança

| Aspecto | Implementação |
|---------|--------------|
| Senhas | SHA-256 duplo + salt 16 bytes |
| Sessões | Token 64 chars hex, 30 dias |
| Rate Limiting | Login 5/min, Registro 3/5min |
| XSS | Sanitização completa em todas as entradas |
| Localização | Ofuscada ±500m por padrão |
| Dados públicos | Telefone/email mascarados |

📄 Detalhes completos: [SECURITY.md](SECURITY.md)

---

## 🛡️ Privacidade (LGPD)

- Sem cookies de rastreamento
- Sem compartilhamento com terceiros
- IA roda 100% no navegador (fotos nunca saem do dispositivo)
- Localização nunca exibida com precisão para outros
- Direito de exclusão garantido

📄 Política completa: [PRIVACY.md](PRIVACY.md)

---

## 🏗️ Arquitetura

```
Usuário → App.js (UI) → DB.js → Firestore (Google Cloud)
              │                      │
              │ Security.js          │ Fallback
              │ (sanitize, hash)     ▼
              │                  REST API
              ▼
          Auth.js (sessão local, SHA-256)
```

📄 Arquitetura detalhada: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## 🚢 Deploy

### Netlify (recomendado)

1. Faça push para o GitHub
2. Conecte o repositório no [Netlify](https://netlify.com)
3. Build command: *(vazio — sem build)*
4. Publish directory: `.`
5. Configure as variáveis (se necessário)

### Outros hosts estáticos

O projeto funciona em qualquer host de site estático:
- GitHub Pages
- Vercel
- Cloudflare Pages
- Firebase Hosting
- Surge.sh

> Basta servir a pasta raiz como site estático.

---

## 🤝 Como Contribuir

1. Fork o repositório
2. Crie uma branch (`git checkout -b feature/minha-feature`)
3. Commit (`git commit -m 'Adiciona funcionalidade X'`)
4. Push (`git push origin feature/minha-feature`)
5. Abra um Pull Request

📄 Guia completo: [CONTRIBUTING.md](CONTRIBUTING.md)

---

## 📋 Roadmap

### v1.1.0
- [ ] Notificações push (Firebase Cloud Messaging)
- [ ] Compartilhar alerta via WhatsApp
- [ ] Filtros no mapa
- [ ] Múltiplas fotos por pet

### v1.2.0
- [ ] Firebase Storage para fotos
- [ ] Testes automatizados
- [ ] Dark mode
- [ ] Integração com ONGs

### v2.0.0
- [ ] App nativo (React Native)
- [ ] Backend dedicado
- [ ] OAuth (Google, Facebook)
- [ ] ML avançado (modelo próprio)

📄 Histórico completo: [CHANGELOG.md](CHANGELOG.md)

---

## 📊 Dados Técnicos

| Métrica | Valor |
|---------|-------|
| Tamanho total do app | ~200KB (sem CDNs) |
| Tempo de carregamento | ~3s (primeira vez), ~1s (cache) |
| Compressão de foto | ~500ms |
| IA (MobileNet) | ~12s (primeira carga), ~200ms (análise) |
| Suporte offline | ✅ Completo |
| Navegadores | Chrome 80+, Firefox 78+, Safari 14+, Edge 80+ |

---

## 📜 Licença

Este projeto está licenciado sob a [MIT License](LICENSE).

---

## 🙏 Agradecimentos

- [Firebase](https://firebase.google.com) — Banco de dados Firestore
- [TensorFlow.js](https://www.tensorflow.org/js) — IA no navegador
- [Font Awesome](https://fontawesome.com) — Ícones
- [Google Fonts](https://fonts.google.com) — Tipografia Nunito
- [Netlify](https://netlify.com) — Hospedagem gratuita

---

<p align="center">
  <strong>Encontre Pet</strong> — Ajudando pets perdidos a voltarem para casa 🐾❤️
  <br><br>
  <a href="https://encontre-pet.netlify.app">🌐 App ao vivo</a> ·
  <a href="SECURITY.md">🔒 Segurança</a> ·
  <a href="PRIVACY.md">🛡️ Privacidade</a> ·
  <a href="CONTRIBUTING.md">🤝 Contribuir</a>
</p>
