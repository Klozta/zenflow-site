#!/bin/bash
# 🍪 Test des cookies HTTP-only - ZenFlow Backend
# Vérifie que les cookies sont bien HTTP-only et sécurisés

set -e

API_URL="${API_URL:-http://localhost:3001}"
TEST_EMAIL="test-$(date +%s)@example.com"
TEST_PASSWORD="Test1234!"

echo "🍪 Test des cookies HTTP-only"
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
    echo "$response" | grep -i "set-cookie" | sed 's/Set-Cookie: //i'
}

# Test 1: Inscription
echo "1. Test inscription (création cookies)"
response=$(curl -s -i -X POST "$API_URL/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{
        \"email\": \"$TEST_EMAIL\",
        \"password\": \"$TEST_PASSWORD\",
        \"firstName\": \"Test\",
        \"lastName\": \"User\"
    }" 2>&1)

cookies=$(extract_cookies "$response")
http_code=$(echo "$response" | grep -i "HTTP" | tail -n1 | awk '{print $2}')

if [ "$http_code" = "201" ] || [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✓${NC} Inscription réussie (HTTP $http_code)"

    if [ -n "$cookies" ]; then
        echo -e "${GREEN}✓${NC} Cookies reçus"
        echo "$cookies" | sed 's/^/  /'

        # Vérifier HttpOnly
        if echo "$cookies" | grep -qi "HttpOnly"; then
            echo -e "${GREEN}✓${NC} Cookie HttpOnly présent"
        else
            echo -e "${RED}✗${NC} Cookie HttpOnly manquant"
        fi

        # Vérifier Secure (en production)
        if echo "$cookies" | grep -qi "Secure"; then
            echo -e "${GREEN}✓${NC} Cookie Secure présent"
        else
            echo -e "${YELLOW}⚠${NC} Cookie Secure absent (normal en dev HTTP)"
        fi
    else
        echo -e "${RED}✗${NC} Aucun cookie reçu"
    fi
else
    echo -e "${RED}✗${NC} Inscription échouée (HTTP $http_code)"
    echo "$response" | tail -n5
fi

# Test 2: Login
echo ""
echo "2. Test login (création cookies)"
response=$(curl -s -i -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{
        \"email\": \"$TEST_EMAIL\",
        \"password\": \"$TEST_PASSWORD\"
    }" \
    -c cookies.txt 2>&1)

cookies=$(extract_cookies "$response")
http_code=$(echo "$response" | grep -i "HTTP" | tail -n1 | awk '{print $2}')

if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✓${NC} Login réussi (HTTP $http_code)"

    if [ -f "cookies.txt" ]; then
        echo -e "${GREEN}✓${NC} Cookies sauvegardés dans cookies.txt"

        # Vérifier le contenu
        if grep -q "access_token\|refresh_token" cookies.txt; then
            echo -e "${GREEN}✓${NC} Tokens présents dans les cookies"
        else
            echo -e "${YELLOW}⚠${NC} Tokens non trouvés dans cookies.txt"
        fi
    fi
else
    echo -e "${RED}✗${NC} Login échoué (HTTP $http_code)"
fi

# Test 3: Utilisation des cookies
echo ""
echo "3. Test utilisation cookies (GET /api/auth/me)"
if [ -f "cookies.txt" ]; then
    response=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/api/auth/me" \
        -b cookies.txt 2>&1)

    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$http_code" = "200" ]; then
        echo -e "${GREEN}✓${NC} Authentification avec cookies réussie (HTTP $http_code)"
        echo "  Réponse: $(echo "$body" | jq -r '.email // .id // "OK"' 2>/dev/null || echo "OK")"
    else
        echo -e "${RED}✗${NC} Authentification échouée (HTTP $http_code)"
        echo "  Réponse: $body"
    fi
else
    echo -e "${YELLOW}⚠${NC} Fichier cookies.txt manquant, test ignoré"
fi

# Nettoyage
rm -f cookies.txt

echo ""
echo "=============================="
echo -e "${GREEN}✅ Tests terminés${NC}"





