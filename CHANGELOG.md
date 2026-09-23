# 📋 Changelog — Encontre Pet

Todas as alterações notáveis deste projeto são documentadas neste arquivo.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).  
Versionamento segue [Semantic Versioning](https://semver.org/lang/pt-BR/).

---

## [1.20.1] — 2026-09-23

### Corrigido
- **Tela de notificações vazia para todos**: `listarNotificacoes` fazia 2 queries no mesmo `try`; a query por `destinatario_uid` (ID do app `u_xxx`/`anon_xxx`) é sempre negada pelas rules e descartava o resultado da query por Firebase UID. Achado no teste E2E de produção de 2026-09-23. A query extra (e o listener correspondente em `watchNotificacoes`) só roda quando a rule pode permitir

---

## [1.20.0] — 2026-07-20

### 🚀 Backend gratuito — Cloud Functions → Netlify Functions (Fase A do PLANO_ESTRUTURACAO.md)

#### Adicionado
- **`netlify/functions/`** — backend completo em Netlify Functions + firebase-admin (projeto permanece no plano Spark, sem cartão): `get-tutor-contact`, `get-sighter-contact`, `save-user-password`, `verify-user-password`, `login-user`, `check-email-exists`, `notify-tutor-contact`, `count-users-in-radius`
- **`process-avistamento`** — substituto idempotente do trigger `onAvistamentoCreated` (notificações de match ao tutor E avistador, criação de conversa, vínculos LGPD/S-08), invocado pelo cliente pós-create com retry
- **`sweep-avistamentos`** (scheduled 6/6h) — reprocessa avistamentos pendentes (rede de segurança)
- **`auto-confirmar-reunioes`** (scheduled diário) — confirmação unilateral após 7 dias (North Star)
- **`js/services/backend.js`** — shim com assinatura `httpsCallable()` idêntica ao SDK; zero mudança nos call sites

#### Corrigido (achados do teste E2E de 2026-07-05)
- Tutor volta a receber notificação de match/avistamento (achado 1 — North Star)
- Removido fallback que gravava `senha_hash` no doc `usuarios` (achado 2 — regressão S-03)
- Contador "pessoas alcançadas" via backend Admin SDK (achado 3 — N-01)
- Acesso cruzado LGPD (`linked_pet_owner_firebase_uid` + `sighter_authorizations`) garantido server-side (achado 5)
- `netlify.toml`: removido `ignore = "exit 0"` que fazia o Netlify pular builds de git push

#### Segurança / LGPD (revisão de 2026-09-23)
- **`save-user-password` / `verify-user-password`**: exigem posse da conta (`firebase_auth_uids`). Antes qualquer autenticado — até anônimo — podia trocar a senha de outra conta e entrar nela pelo `login-user` (falha herdada da CF original)
- `changePassword`: removido o último fallback que gravava `senha_hash` em `usuarios` (S-03)
- **Revertida** a leitura do `alert_privado` do avistador pelo tutor (expunha telefone/localização sem log LGPD). No lugar, `vinculos_avistamento/{avistamentoId}` só com UIDs, gravado pelo backend
- `get-tutor-contact`: prova de avistamento vinculado via `vinculos_avistamento` (os docs públicos pós-S-08 não têm `owner_firebase_uid`, então ninguém recebia o contato)

#### Custo (cota grátis)
- **Foto cheia fora do doc público**: sem bucket de Storage no Spark, a foto vai para `fotos/{colecao}_{id}` (lida só no detalhe). O feed carrega apenas `foto_thumb` (~10KB). `migrate-p0-foto-thumb.js` move as fotos antigas
- `count-users-in-radius`: 1 read (agregado `stats/usuarios_geo`, refeito ≤1×/dia) em vez de até 1000 reads por abertura da Home; cache de 1h no cliente
- `netlify.toml`: JS/CSS com `must-revalidate` (antes `immutable` por 1 ano sem `?v=` — o app não atualizava após deploy); SW com cache dinâmico versionado e precache `cache: 'reload'`

#### i18n
- Modais do avistador (feedback de match e "Avisar o tutor") nos 3 idiomas (E2E achado 6)

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
