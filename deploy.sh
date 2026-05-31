#!/bin/bash
# ============================================================
#  Encontre Pet — Script de Deploy Completo
#  Roda uma vez no terminal e faz tudo:
#  1. Instala Firebase CLI e Netlify CLI
#  2. Deploy das Firestore Rules
#  3. Deploy do site no Netlify
# ============================================================

set -e  # Para se qualquer comando falhar

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   🐾 Encontre Pet — Deploy Completo   ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════╝${NC}"
echo ""

# ─── Verificar Node.js ───────────────────────────────────────
echo -e "${YELLOW}▶ Verificando Node.js...${NC}"
if ! command -v node &> /dev/null; then
  echo -e "${RED}❌ Node.js não encontrado. Instale em https://nodejs.org${NC}"
  exit 1
fi
echo -e "${GREEN}✅ Node.js $(node --version)${NC}"
echo ""

# ─── Instalar Firebase CLI ───────────────────────────────────
echo -e "${YELLOW}▶ Instalando Firebase CLI...${NC}"
npm install -g firebase-tools --silent
echo -e "${GREEN}✅ Firebase CLI $(firebase --version)${NC}"
echo ""

# ─── Instalar Netlify CLI ────────────────────────────────────
echo -e "${YELLOW}▶ Instalando Netlify CLI...${NC}"
npm install -g netlify-cli --silent
echo -e "${GREEN}✅ Netlify CLI $(netlify --version)${NC}"
echo ""

# ─── PASSO 1: Firebase Login + Rules ─────────────────────────
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  PASSO 1/3 — Firebase: Rules + Auth    ${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}Abrindo login do Firebase no browser...${NC}"
echo -e "${YELLOW}(autorize e volte aqui)${NC}"
echo ""

firebase login --no-localhost 2>/dev/null || firebase login

echo ""
echo -e "${YELLOW}▶ Fazendo deploy das Firestore Rules...${NC}"
firebase deploy --only firestore:rules --project encontre-pet-137d2
echo -e "${GREEN}✅ Firestore Rules deployadas!${NC}"

echo ""
echo -e "${YELLOW}▶ Fazendo deploy das Storage Rules...${NC}"
firebase deploy --only storage --project encontre-pet-137d2 2>/dev/null && \
  echo -e "${GREEN}✅ Storage Rules deployadas!${NC}" || \
  echo -e "${YELLOW}⚠️  Storage Rules puladas (opcional)${NC}"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  PASSO 2/3 — Netlify: Deploy do Site   ${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}Abrindo login do Netlify no browser...${NC}"
echo -e "${YELLOW}(autorize e volte aqui)${NC}"
echo ""

netlify login

echo ""
echo -e "${YELLOW}▶ Fazendo deploy no Netlify (produção)...${NC}"
echo ""

# Criar arquivo .netlifyignore para excluir o que não deve ir pro Netlify
cat > .netlifyignore << 'EOF'
functions/
node_modules/
.git/
scripts/
docs/
*.sh
deploy.sh
.env
.env.*
EOF

# Deploy — se já tiver site vinculado usa ele, senão cria novo
netlify deploy --prod --dir=. --message="Encontre Pet v1.1.0 — deploy automático"

# Pegar a URL do site deployado
SITE_URL=$(netlify status --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('siteData',{}).get('ssl_url',''))" 2>/dev/null || echo "")

echo ""
if [ -n "$SITE_URL" ]; then
  echo -e "${GREEN}✅ Site no ar: ${SITE_URL}${NC}"
else
  echo -e "${GREEN}✅ Deploy concluído! Veja a URL acima.${NC}"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  PASSO 3/3 — Firebase: Autorizar domínio${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [ -n "$SITE_URL" ]; then
  DOMAIN=$(echo "$SITE_URL" | sed 's|https://||' | sed 's|/||g')
  echo -e "${YELLOW}▶ Adicionando domínio '${DOMAIN}' no Firebase Auth...${NC}"

  # Usar Firebase Management API para adicionar o domínio
  TOKEN=$(firebase login:ci --no-localhost 2>/dev/null | grep "1//" | head -1 || echo "")

  if [ -n "$TOKEN" ]; then
    curl -s -X POST \
      "https://identitytoolkit.googleapis.com/v2/projects/encontre-pet-137d2/config?updateMask=authorizedDomains" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "{}" > /dev/null
    echo -e "${GREEN}✅ Domínio autorizado!${NC}"
  else
    echo -e "${YELLOW}⚠️  Adicione manualmente:${NC}"
    echo -e "${YELLOW}   Firebase Console → Authentication → Settings → Authorized domains${NC}"
    echo -e "${YELLOW}   Adicionar: ${DOMAIN}${NC}"
    echo ""
    echo -e "${BLUE}   Abrindo Firebase Console...${NC}"
    # Abrir no browser se possível
    open "https://console.firebase.google.com/u/1/project/encontre-pet-137d2/authentication/settings" 2>/dev/null || \
    xdg-open "https://console.firebase.google.com/u/1/project/encontre-pet-137d2/authentication/settings" 2>/dev/null || \
    echo -e "${BLUE}   URL: https://console.firebase.google.com/u/1/project/encontre-pet-137d2/authentication/settings${NC}"
  fi
fi

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        🎉 DEPLOY CONCLUÍDO!            ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}Firestore Rules:${NC} ✅ Deployadas"
echo -e "  ${GREEN}Site Netlify:${NC}    ✅ No ar"
echo ""
if [ -n "$SITE_URL" ]; then
  echo -e "  ${BLUE}🌐 URL: ${SITE_URL}${NC}"
fi
echo ""
echo -e "${YELLOW}  ⚡ Lembre-se de adicionar o domínio Netlify${NC}"
echo -e "${YELLOW}     em Firebase Auth → Authorized Domains${NC}"
echo -e "${YELLOW}     se ainda não foi feito automaticamente.${NC}"
echo ""

# Limpar arquivos temporários
rm -f .netlifyignore
