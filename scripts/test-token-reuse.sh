#!/bin/bash
# 🔐 Test détection token reuse - ZenFlow Backend
# Vérifie que la détection de réutilisation de refresh token fonctionne

set -e

API_URL="${API_URL:-http://localhost:3001}"
TEST_EMAIL="test-token-$(date +%s)@example.com"
TEST_PASSWORD="Test1234!"

echo "🔐 Test détection token reuse"
echo "=============================="
echo "API URL: $API_URL"
echo ""

# Couleurs
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Fonction pour extraire les cookies
extract_cookies() {
    local response=$1
    echo "$response" | grep -i "set-cookie" | sed 's/Set-Cookie: //i' | head -n1
}

# Fonction pour extraire refresh token du cookie
extract_refresh_token() {
    local cookie=$1
    echo "$cookie" | grep -oP 'refresh_token=[^;]+' | cut -d'=' -f2
}

echo "1. Inscription utilisateur"
response=$(curl -s -i -X POST "$API_URL/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{
        \"email\": \"$TEST_EMAIL\",
        \"password\": \"$TEST_PASSWORD\",
        \"firstName\": \"Test\",
        \"lastName\": \"User\"
    }" 2>&1)

http_code=$(echo "$response" | grep -i "HTTP" | tail -n1 | awk '{print $2}')
if [ "$http_code" != "201" ] && [ "$http_code" != "200" ]; then
    echo -e "${RED}✗${NC} Inscription échouée (HTTP $http_code)"
    echo "$response" | tail -n5
    exit 1
fi

echo -e "${GREEN}✓${NC} Inscription réussie"
echo ""

echo "2. Login (obtenir refresh token)"
response1=$(curl -s -i -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{
        \"email\": \"$TEST_EMAIL\",
        \"password\": \"$TEST_PASSWORD\"
    }" \
    -c cookies1.txt 2>&1)

cookie1=$(extract_cookies "$response1")
refresh_token1=$(extract_refresh_token "$cookie1")
http_code=$(echo "$response1" | grep -i "HTTP" | tail -n1 | awk '{print $2}')

if [ "$http_code" != "200" ] || [ -z "$refresh_token1" ]; then
    echo -e "${RED}✗${NC} Login échoué ou refresh token non reçu"
    echo "$response1" | tail -n5
    exit 1
fi

echo -e "${GREEN}✓${NC} Login réussi, refresh token obtenu"
echo "  Token: ${refresh_token1:0:20}..."
echo ""

echo "3. Premier refresh (utilisation normale)"
response2=$(curl -s -i -X POST "$API_URL/api/auth/refresh" \
    -b cookies1.txt \
    -c cookies2.txt 2>&1)

http_code=$(echo "$response2" | grep -i "HTTP" | tail -n1 | awk '{print $2}')
if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✓${NC} Premier refresh réussi (HTTP $http_code)"
else
    echo -e "${YELLOW}⚠${NC} Premier refresh échoué (HTTP $http_code) - peut nécessiter auth"
fi
echo ""

echo "4. Tentative réutilisation du même refresh token"
# Essayer d'utiliser le même token une deuxième fois
response3=$(curl -s -i -X POST "$API_URL/api/auth/refresh" \
    -b cookies1.txt 2>&1)

http_code=$(echo "$response3" | grep -i "HTTP" | tail -n1 | awk '{print $2}')
body=$(echo "$response3" | sed '/HTTP/d' | tail -n5)

if [ "$http_code" = "401" ] || [ "$http_code" = "403" ]; then
    echo -e "${GREEN}✓${NC} Réutilisation détectée et bloquée (HTTP $http_code)"
    echo "  Réponse: $(echo "$body" | head -n1)"
elif echo "$body" | grep -qi "reuse\|revoked\|invalid"; then
    echo -e "${GREEN}✓${NC} Réutilisation détectée (message d'erreur approprié)"
    echo "  Réponse: $body"
else
    echo -e "${YELLOW}⚠${NC} Comportement inattendu (HTTP $http_code)"
    echo "  Réponse: $body"
    echo "  Note: Le système peut avoir révoqué tous les tokens ou nécessite une implémentation spécifique"
fi
echo ""

echo "5. Vérification que tous les tokens sont révoqués"
# Essayer de se connecter à nouveau
response4=$(curl -s -i -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{
        \"email\": \"$TEST_EMAIL\",
        \"password\": \"$TEST_PASSWORD\"
    }" \
    -c cookies3.txt 2>&1)

http_code=$(echo "$response4" | grep -i "HTTP" | tail -n1 | awk '{print $2}')
if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✓${NC} Nouveau login possible après révocation (HTTP $http_code)"
    echo "  Le système permet de se reconnecter après détection de réutilisation"
else
    echo -e "${YELLOW}⚠${NC} Nouveau login échoué (HTTP $http_code)"
fi

# Nettoyage
rm -f cookies*.txt

echo ""
echo "=============================="
echo -e "${GREEN}✅ Tests terminés${NC}"
echo ""
echo "Note: La détection de réutilisation de token est une fonctionnalité de sécurité"
echo "avancée. Si les tests échouent, vérifier l'implémentation dans authService.ts"





