# 🔒 Política de Segurança — Encontre Pet

## Relatando Vulnerabilidades

Se você encontrou uma vulnerabilidade de segurança no Encontre Pet, **não abra uma issue pública**.

📧 **Envie para**: encontrepet.seguranca@gmail.com  
⏱️ **Tempo de resposta**: até 48 horas  
🔐 **Tratamento**: confidencial até a correção ser aplicada  

Inclua na sua mensagem:
- Descrição detalhada da vulnerabilidade
- Passos para reproduzir
- Impacto potencial
- Sugestão de correção (se possível)

---

## Arquitetura de Segurança

### 1. Autenticação Local (sem Firebase Auth)

| Aspecto | Implementação |
|---------|--------------|
| **Hashing de senha** | SHA-256 duplo + salt aleatório (Web Crypto API) |
| **Salt** | 16 bytes aleatórios via `crypto.getRandomValues()` |
| **Formato armazenado** | `salt:hash` (nunca texto plano) |
| **Token de sessão** | 32 bytes aleatórios = 64 caracteres hex |
| **Expiração** | 30 dias após login |
| **Armazenamento** | `localStorage` (criptografado pelo navegador) |

**Por que SHA-256 e não bcrypt?**  
O Encontre Pet roda 100% no navegador (static site). Não há servidor backend para executar bcrypt. O SHA-256 com duplo hash + salt único é a melhor opção disponível no ambiente client-side usando a Web Crypto API nativa.

### 2. Rate Limiting

| Ação | Limite | Janela |
|------|--------|--------|
| Login | 5 tentativas | 60 segundos |
| Registro | 3 tentativas | 5 minutos |
| Reportar pet | 3 reportes | 5 minutos |

Implementado via `Security.checkRateLimit()` — armazenado em memória (reset ao recarregar página).

### 3. Sanitização de Dados

Toda entrada de usuário é sanitizada antes de armazenamento:

```
Função                 O que faz
────────────────────── ─────────────────────────────────────
Security.sanitize()    Remove HTML, <script>, javascript:, on*= 
Security.sanitizePhone() Aceita apenas números e formatação
Security.sanitizeEmail() Aceita apenas chars válidos de email
Security.sanitizeObject() Recursivo para objetos inteiros
Security.validateReportData() Valida tipo, foto, telefone, descrição
```

**Proteção contra XSS**: Toda string inserida em HTML via `innerHTML` passa por `Security.sanitize()` que converte `<`, `>`, `"`, `'`, `/` em entidades HTML.

### 4. Proteção de Localização

A localização **real** do usuário nunca é exibida publicamente:

```
Coordenadas GPS ──► obfuscateLocation() ──► +/- 500m aleatório
                                            ├── Distribuição uniforme circular
                                            ├── Truncamento 4 casas decimais
                                            └── Remoção do nº da rua do endereço
```

| Configuração | Padrão | Descrição |
|-------------|--------|-----------|
| `localizacao_aproximada` | `true` | Ofuscar coordenadas |
| `raio_ofuscacao_m` | 500m | Raio de ofuscação |

### 5. Dados Públicos vs. Privados

Quando um pet é exibido para **outros usuários**, `Security.sanitizeForPublic()` remove:

| Campo removido | Motivo |
|---------------|--------|
| `contato_telefone` | Substituído por versão mascarada `****-**XX` |
| `contato_email` | Substituído por versão mascarada `j***@g****.com` |
| `latitude` / `longitude` | Mantém apenas `latitude_publica` (ofuscada) |
| `owner_uid` | Identificador interno do dono |
| `embedding` | Dados de IA internos |
| `foto_hash` | Hash interno de comparação |
| `senha_hash` | Nunca deve sair do registro do usuário |

### 6. Firebase / Firestore

| Aspecto | Status |
|---------|--------|
| **Firebase Auth** | ❌ Não utilizado (auth é local) |
| **Firestore** | ✅ Usado como banco de dados |
| **API Key exposta** | ⚠️ Normal para Firestore público — protegido por Security Rules |
| **Security Rules** | ✅ Configuradas (ver seção abaixo) |

#### Regras Firestore Recomendadas

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /pets_perdidos/{petId} {
      allow read: if true;
      allow create: if true;
      allow update, delete: if resource.data.owner_uid == request.resource.data.owner_uid;
    }
    match /avistamentos/{avistId} {
      allow read, create: if true;
      allow update, delete: if resource.data.owner_uid == request.resource.data.owner_uid;
    }
    match /notificacoes/{notifId} {
      allow read, create, update: if true;
      allow delete: if false;
    }
    match /usuarios/{userId} {
      allow read: if true;
      allow create: if true;
      allow update: if true;
      allow delete: if false;
    }
  }
}
```

### 7. Service Worker

| Aspecto | Implementação |
|---------|--------------|
| **Cache de API Keys** | ❌ Não cacheia respostas sensíveis |
| **Firestore passthrough** | ✅ Requisições `firestore.googleapis.com` não são cacheadas |
| **Atualização automática** | ✅ `skipWaiting` + banner de atualização |
| **Escopo** | `/` — apenas o próprio domínio |

### 8. Dependências Externas

| Dependência | Versão | CDN | Risco |
|------------|--------|-----|-------|
| Firebase SDK | 10.14.1 | gstatic.com | Baixo (Google) |
| TensorFlow.js | 4.21.0 | jsdelivr.net | Baixo (Google) |
| MobileNet | 2.1.1 | jsdelivr.net | Baixo (Google) |
| Font Awesome | 6.4.0 | jsdelivr.net | Baixo |
| Google Fonts | Nunito | fonts.googleapis.com | Baixo (Google) |

Todas as dependências são de fontes confiáveis (Google, jsDelivr).

---

## Checklist de Segurança — Auditoria v1.0.0

| # | Verificação | Status | Notas |
|---|-----------|--------|-------|
| 1 | Senhas hasheadas com salt | ✅ | SHA-256 duplo + salt 16 bytes |
| 2 | Senhas nunca em texto plano | ✅ | Formato `salt:hash` |
| 3 | Inputs sanitizados contra XSS | ✅ | `Security.sanitize()` em todas as entradas |
| 4 | Rate limiting em login | ✅ | 5/min |
| 5 | Rate limiting em registro | ✅ | 3/5min |
| 6 | Rate limiting em reportes | ✅ | 3/5min |
| 7 | Localização ofuscada | ✅ | ±500m padrão |
| 8 | Dados sensíveis removidos de views públicas | ✅ | `sanitizeForPublic()` |
| 9 | Telefone mascarado | ✅ | `****-**XX` |
| 10 | Email mascarado | ✅ | `j***@g****.com` |
| 11 | Sessão com expiração | ✅ | 30 dias |
| 12 | Token de sessão criptograficamente seguro | ✅ | `crypto.getRandomValues(32)` |
| 13 | Firestore Security Rules | ✅ | Documentadas |
| 14 | HTTPS obrigatório | ✅ | Netlify + meta referrer |
| 15 | Sem eval() ou Function() | ✅ | Verificado em todos os JS |
| 16 | Sem innerHTML com dados não sanitizados | ✅ | Todos passam por `Security.sanitize()` |
| 17 | `data:` URI filtrado (exceto imagens) | ✅ | `data:image/` permitido, resto bloqueado |
| 18 | Fotos comprimidas client-side | ✅ | Máx 120KB, JPEG |
| 19 | Validação de tamanho de foto | ✅ | `validateReportData()` |
| 20 | Sem credenciais hardcoded em JS | ⚠️ | Firebase API Key é esperado ser público |

---

## Limitações Conhecidas

1. **SHA-256 vs bcrypt**: Em um PWA client-side, não é possível usar bcrypt. SHA-256 duplo com salt é a melhor alternativa disponível.
2. **localStorage**: Sessões ficam em localStorage. Um atacante com acesso físico ao dispositivo pode extrair o token. Mitigação: expiração de 30 dias.
3. **Firebase API Key pública**: A chave é visível no código-fonte. Isso é o design esperado do Firebase para apps client-side. A proteção é feita via Firestore Security Rules.
4. **Rate limiting em memória**: Recarregar a página reseta o rate limit. Para proteção robusta, seria necessário um backend.

---

## Versões Suportadas

| Versão | Suportada |
|--------|-----------|
| 1.0.x  | ✅ Ativa  |
| < 1.0  | ❌ Descontinuada |

---

*Última auditoria: 17 de fevereiro de 2026*  
*Próxima revisão programada: 17 de maio de 2026*
