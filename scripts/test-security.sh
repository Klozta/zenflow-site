#!/bin/bash
# 🔒 Script de test sécurité - ZenFlow Backend
# Teste les endpoints critiques et la sécurité

set -e

API_URL="${API_URL:-http://localhost:3001}"
CRON_KEY="${CRON_API_KEY:-test-key}"

echo "🔒 Tests de sécurité - ZenFlow Backend"
echo "=========================================="
echo "API URL: $API_URL"
echo ""

# Couleurs
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Fonction de test
test_endpoint() {
    local name=$1
    local method=$2
    local url=$3
    local expected_status=$4
    local headers=$5

    echo -n "Test: $name... "

    if [ -z "$headers" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$url" 2>&1)
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$url" -H "$headers" 2>&1)
    fi

    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$http_code" = "$expected_status" ]; then
        echo -e "${GREEN}✓${NC} (HTTP $http_code)"
        return 0
    else
        echo -e "${RED}✗${NC} (HTTP $http_code, attendu $expected_status)"
        echo "  Réponse: $body"
        return 1
    fi
}

# Tests
PASSED=0
FAILED=0

echo "1. Health Check"
test_endpoint "Health check" "GET" "$API_URL/health" "200" && ((PASSED++)) || ((FAILED++))

echo ""
echo "2. Rate Limiting"
echo "  Test: Rate limit (100 requêtes)..."
for i in {1..105}; do
    response=$(curl -s -w "\n%{http_code}" "$API_URL/api" 2>&1)
    http_code=$(echo "$response" | tail -n1)
    if [ "$i" -eq 105 ] && [ "$http_code" = "429" ]; then
        echo -e "  ${GREEN}✓${NC} Rate limit actif (HTTP 429)"
        ((PASSED++))
    elif [ "$i" -eq 105 ] && [ "$http_code" != "429" ]; then
        echo -e "  ${RED}✗${NC} Rate limit non actif (HTTP $http_code)"
        ((FAILED++))
    fi
done

echo ""
echo "3. CORS"
test_endpoint "CORS avec origin valide" "OPTIONS" "$API_URL/api" "204" "Origin: http://localhost:3000" && ((PASSED++)) || ((FAILED++))
test_endpoint "CORS avec origin invalide" "OPTIONS" "$API_URL/api" "403" "Origin: https://evil.com" && ((PASSED++)) || ((FAILED++))

echo ""
echo "4. Security Headers"
echo -n "  Test: Headers sécurité... "
headers=$(curl -s -I "$API_URL/health" | grep -iE "(x-frame-options|strict-transport-security|x-content-type-options)")
if [ -n "$headers" ]; then
    echo -e "${GREEN}✓${NC}"
    echo "$headers" | sed 's/^/    /'
    ((PASSED++))
else
    echo -e "${RED}✗${NC} Headers sécurité manquants"
    ((FAILED++))
fi

echo ""
echo "5. Cron Jobs"
test_endpoint "Cron sans clé" "POST" "$API_URL/api/cron/abandoned-carts" "401" && ((PASSED++)) || ((FAILED++))
test_endpoint "Cron avec clé valide" "POST" "$API_URL/api/cron/abandoned-carts" "200" "X-Cron-Key: $CRON_KEY" && ((PASSED++)) || ((FAILED++))

echo ""
echo "6. Auth Endpoints"
test_endpoint "Register sans données" "POST" "$API_URL/api/auth/register" "400" && ((PASSED++)) || ((FAILED++))
test_endpoint "Login sans données" "POST" "$API_URL/api/auth/login" "400" && ((PASSED++)) || ((FAILED++))

echo ""
echo "7. Validation Inputs"
test_endpoint "Products avec paramètres invalides" "GET" "$API_URL/api/products?page=-1&limit=9999" "400" && ((PASSED++)) || ((FAILED++))

# Résumé
echo ""
echo "=========================================="
echo "Résumé:"
echo -e "  ${GREEN}✓ Passés: $PASSED${NC}"
echo -e "  ${RED}✗ Échoués: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ Tous les tests sont passés !${NC}"
    exit 0
else
    echo -e "${RED}❌ Certains tests ont échoué${NC}"
    exit 1
fi





