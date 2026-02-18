# 🛡️ Política de Privacidade — Encontre Pet

**Última atualização**: 17 de fevereiro de 2026  
**Versão do app**: 1.0.0  
**Idioma**: Português (Brasil)  
**Conformidade**: LGPD (Lei nº 13.709/2018)

---

## 1. Introdução

O **Encontre Pet** é um aplicativo web progressivo (PWA) gratuito que ajuda pessoas a encontrar pets perdidos através de alertas por proximidade e comparação de fotos por inteligência artificial.

Esta política descreve como coletamos, usamos, armazenamos e protegemos seus dados pessoais, em conformidade com a **Lei Geral de Proteção de Dados (LGPD)**.

---

## 2. Dados Coletados

### 2.1 Dados fornecidos pelo usuário

| Dado | Finalidade | Base Legal (LGPD) |
|------|-----------|-------------------|
| Nome | Identificação no app | Consentimento (Art. 7º, I) |
| E-mail | Login e comunicação | Execução de contrato (Art. 7º, V) |
| Senha | Autenticação | Execução de contrato (Art. 7º, V) |
| Telefone | Contato sobre pet encontrado | Consentimento (Art. 7º, I) |
| Foto do pet | Identificação e matching por IA | Consentimento (Art. 7º, I) |
| Descrição do pet | Busca e identificação | Consentimento (Art. 7º, I) |

### 2.2 Dados coletados automaticamente

| Dado | Finalidade | Base Legal |
|------|-----------|------------|
| Geolocalização (GPS) | Alertas por proximidade | Consentimento explícito (Art. 7º, I) |
| Dados de uso do app | Melhorar experiência | Legítimo interesse (Art. 7º, IX) |

### 2.3 Dados que **NÃO** coletamos

- ❌ Dados de cartão de crédito ou financeiros
- ❌ CPF, RG ou documentos de identidade
- ❌ Dados de menores de 18 anos (conscientemente)
- ❌ Dados de saúde ou biométricos
- ❌ Dados de navegação em outros sites
- ❌ Cookies de rastreamento de terceiros

---

## 3. Como Protegemos Seus Dados

### 3.1 Senhas
- **Nunca armazenadas em texto plano**
- Hasheadas com SHA-256 + salt aleatório de 16 bytes
- Salt único por usuário via Web Crypto API
- Formato armazenado: `salt:hash` (irreversível)

### 3.2 Localização
- **Nunca exibida com precisão exata** para outros usuários
- Ofuscação padrão de ±500 metros
- Número da rua removido do endereço público
- Usuário controla o raio de ofuscação nas configurações

### 3.3 Dados de Contato
- Telefone exibido como: `(11) 9****-**89`
- E-mail exibido como: `j***@g****.com`
- Dados reais acessíveis apenas ao dono do reporte

### 3.4 Sessão
- Token de sessão gerado com `crypto.getRandomValues()`
- Expiração automática em 30 dias
- Armazenado localmente no dispositivo (localStorage)

### 3.5 Fotos
- Comprimidas no dispositivo antes do envio (máx. 120KB)
- Processadas por IA **localmente no navegador** (MobileNet)
- Nenhum servidor externo processa as fotos

---

## 4. Armazenamento dos Dados

| Local | Tipo de dados | Retenção |
|-------|--------------|----------|
| **Google Firestore** | Perfis, reportes, avistamentos | Até exclusão pelo usuário |
| **localStorage** | Sessão, preferências, cache | Até limpar dados do navegador |
| **IndexedDB** | Cache offline do Firestore | Automático pelo SDK |

### Localização dos servidores
- Firestore: servidores Google (us-central ou conforme configuração)
- CDNs: Google (gstatic), jsDelivr (Cloudflare)
- Hospedagem: Netlify (CDN global)

---

## 5. Compartilhamento de Dados

### 5.1 Compartilhamos com:
- **Google Firebase/Firestore**: Armazenamento de dados (conforme [Política do Google](https://firebase.google.com/support/privacy))
- **Outros usuários do app**: Apenas dados públicos (nome do pet, foto, localização aproximada, descrição)

### 5.2 **NÃO** compartilhamos com:
- ❌ Anunciantes
- ❌ Redes sociais
- ❌ Data brokers
- ❌ Governos (exceto por ordem judicial)
- ❌ Quaisquer terceiros não listados acima

---

## 6. Seus Direitos (LGPD Art. 18)

Você tem direito a:

| Direito | Como exercer |
|---------|-------------|
| **Acesso** aos seus dados | Página de Perfil no app |
| **Correção** de dados | Editar Perfil no app |
| **Exclusão** da conta | Solicitar via e-mail |
| **Portabilidade** | Solicitar via e-mail |
| **Revogar consentimento** | Deslogar + limpar dados do navegador |
| **Saber com quem compartilhamos** | Esta política (seção 5) |
| **Opor-se a tratamento** | Solicitar via e-mail |

📧 **Contato para exercer direitos**: encontrepet.privacidade@gmail.com  
⏱️ **Prazo de resposta**: até 15 dias úteis

---

## 7. Cookies e Armazenamento Local

O Encontre Pet **não usa cookies de rastreamento**.

| Tecnologia | Uso | Dados |
|-----------|-----|-------|
| localStorage | Sessão, preferências | Token de sessão, config do usuário |
| IndexedDB | Cache offline | Dados do Firestore em cache |
| Service Worker | PWA offline | Arquivos do app em cache |

---

## 8. Inteligência Artificial

### 8.1 Como a IA é usada
- **MobileNet**: Analisa fotos de pets para identificar raça e tipo
- **Matching por IA**: Compara fotos de pets perdidos com avistamentos
- **Hash perceptual**: Gera "impressão digital" visual para comparação

### 8.2 Onde a IA roda
- **100% no navegador** (via TensorFlow.js)
- Nenhuma foto é enviada para servidores de IA
- O modelo MobileNet é baixado uma vez e roda localmente

### 8.3 Limitações
- A IA pode errar na identificação de raças
- Resultados de matching são sugestões, não certezas
- O usuário sempre valida os resultados manualmente

---

## 9. Menores de Idade

O Encontre Pet não é direcionado a menores de 18 anos. Não coletamos conscientemente dados de menores. Se tomarmos conhecimento de que um menor forneceu dados, excluiremos as informações imediatamente.

---

## 10. Alterações nesta Política

Reservamo-nos o direito de atualizar esta política. Alterações significativas serão notificadas:
- Banner no app
- Atualização da data no topo deste documento

---

## 11. Contato

**Encontre Pet**  
📧 Privacidade: encontrepet.privacidade@gmail.com  
📧 Segurança: encontrepet.seguranca@gmail.com  
🌐 App: https://encontre-pet.netlify.app  
📁 GitHub: https://github.com/seu-usuario/encontre-pet

---

## 12. Encarregado de Dados (DPO)

Conforme Art. 41 da LGPD, o encarregado pelo tratamento de dados pode ser contactado em:  
📧 encontrepet.privacidade@gmail.com

---

*Esta política é efetiva a partir de 17 de fevereiro de 2026.*
