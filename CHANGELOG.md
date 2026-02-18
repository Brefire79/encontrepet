# 📋 Changelog — Encontre Pet

Todas as alterações notáveis deste projeto são documentadas neste arquivo.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).  
Versionamento segue [Semantic Versioning](https://semver.org/lang/pt-BR/).

---

## [1.0.0] — 2026-02-17

### 🎉 Lançamento Inicial

#### Adicionado
- **PWA completa** — instalável em qualquer dispositivo (Android, iOS, Desktop)
- **Reporte rápido** de pet perdido com foto, localização e contato
- **Avistamento** de pet encontrado com foto e localização
- **Compressão ultra-rápida** de imagens com barra de progresso em tempo real
- **IA no navegador** (MobileNet/TensorFlow.js) para identificação de raça e matching
- **Matching automático** — ao reportar avistamento, a IA compara com pets perdidos
- **Mapa de alertas** com Canvas (sem dependência de Google Maps)
- **Alertas por proximidade** — raio de 5km (cães), 2km (gatos), 3km (outros)
- **Autenticação local** — SHA-256 + salt, sem Firebase Auth
- **Modo visitante** — usar o app sem cadastro
- **Perfil do usuário** com configurações de privacidade
- **Notificações** de matching e avistamentos
- **Ofuscação de localização** — ±500m padrão, configurável
- **Mascaramento de dados** — telefone e email nunca exibidos por completo
- **Rate limiting** — proteção contra abuso (login, registro, reportes)
- **Sanitização completa** — XSS prevention em todas as entradas
- **Offline-first** — Service Worker com cache inteligente
- **Firestore + REST fallback** — dados salvos mesmo se Firestore falhar
- **Fila de sincronização local** — operações offline são salvas para sync
- **Seleção de tipo de animal** — Cão, Gato, Outro (Ave, Coelho, Hamster, etc.)
- **Subtipo "Outro"** com 8 opções predefinidas + texto livre
- **Modal de foto** — opção Câmera ou Galeria ao toque
- **Aba de Patrocinadores** — espaço para apoiadores e parceiros
- **Banner de atualização** — notifica sobre novas versões
- **Política de Privacidade** integrada (LGPD)
- **Documentação completa** — README, SECURITY, PRIVACY, CONTRIBUTING, CHANGELOG

#### Segurança
- Senhas: SHA-256 duplo + salt 16 bytes (Web Crypto API)
- Sessões: token 64 chars hex, expiração 30 dias
- Rate limiting: login (5/min), registro (3/5min), reportes (3/5min)
- Sanitização: HTML entities, remoção de scripts, validação de dados
- Localização: ofuscação ±500m, remoção de nº da rua
- Dados públicos: telefone e email mascarados, coordenadas ofuscadas
- Firestore Security Rules documentadas
- Meta tags de segurança (X-Content-Type-Options, referrer policy)

#### Tecnologias
- HTML5, CSS3, JavaScript ES6+ (sem frameworks)
- Firebase Firestore (banco de dados)
- TensorFlow.js + MobileNet (IA no navegador)
- Service Worker (PWA offline)
- Web Crypto API (hashing)
- Geolocation API (GPS)
- Canvas API (mapa e compressão)
- Font Awesome (ícones)
- Google Fonts (Nunito)

#### Infraestrutura
- Hospedagem: Netlify (CDN global)
- Banco de dados: Google Cloud Firestore
- CI/CD: Netlify auto-deploy via GitHub
- Domínio: encontre-pet.netlify.app

---

## Roadmap

### [1.1.0] — Planejado
- [ ] Notificações push reais (Firebase Cloud Messaging)
- [ ] Compartilhar alerta via WhatsApp, Telegram, Instagram Stories
- [ ] Filtros no mapa (tipo de animal, data, distância)
- [ ] Galeria de fotos (múltiplas por pet)
- [ ] Chat entre quem perdeu e quem avistou

### [1.2.0] — Futuro
- [ ] Firebase Storage para fotos (substituir base64)
- [ ] Testes automatizados (Playwright)
- [ ] Internacionalização (i18n)
- [ ] Dark mode
- [ ] Integração com ONGs e abrigos

### [2.0.0] — Visão
- [ ] App nativo (React Native ou Flutter)
- [ ] Backend dedicado (Node.js ou Go)
- [ ] Autenticação OAuth (Google, Facebook)
- [ ] Machine Learning avançado (modelo próprio treinado)
- [ ] Sistema de recompensas gamificado

---

*Encontre Pet — Ajudando pets perdidos a voltarem para casa* 🐾
