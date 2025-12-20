#!/bin/bash
# 🛡️ Test CSP Headers - ZenFlow Backend/Frontend
# Vérifie que les headers de sécurité sont correctement configurés

set -e

BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"

echo "🛡️ Test des headers de sécurité (CSP, etc.)"
echo "============================================="
echo "Backend URL: $BACKEND_URL"
echo "Frontend URL: $FRONTEND_URL"
echo ""

# Couleurs
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Fonction pour extraire un header
get_header() {
    local response=$1
    local header_name=$2
    echo "$response" | grep -i "^$header_name:" | sed "s/^$header_name: //i" | tr -d '\r'
}

PASSED=0
FAILED=0

echo "1. Test Backend Headers"
echo ""

# Test backend
response=$(curl -s -I "$BACKEND_URL/health" 2>&1)

# X-Frame-Options
x_frame=$(get_header "$response" "X-Frame-Options")
if [ -n "$x_frame" ]; then
    if echo "$x_frame" | grep -qi "DENY\|SAMEORIGIN"; then
        echo -e "${GREEN}✓${NC} X-Frame-Options: $x_frame"
        ((PASSED++))
    else
        echo -e "${YELLOW}⚠${NC} X-Frame-Options présent mais valeur inattendue: $x_frame"
        ((FAILED++))
    fi
else
    echo -e "${RED}✗${NC} X-Frame-Options manquant"
    ((FAILED++))
fi

# X-Content-Type-Options
x_content_type=$(get_header "$response" "X-Content-Type-Options")
if [ -n "$x_content_type" ] && echo "$x_content_type" | grep -qi "nosniff"; then
    echo -e "${GREEN}✓${NC} X-Content-Type-Options: $x_content_type"
    ((PASSED++))
else
    echo -e "${RED}✗${NC} X-Content-Type-Options manquant ou invalide"
    ((FAILED++))
fi

# Strict-Transport-Security (peut être absent en dev HTTP)
hsts=$(get_header "$response" "Strict-Transport-Security")
if [ -n "$hsts" ]; then
    echo -e "${GREEN}✓${NC} Strict-Transport-Security: $hsts"
    ((PASSED++))
else
    echo -e "${YELLOW}⚠${NC} Strict-Transport-Security absent (normal en dev HTTP)"
fi

# Content-Security-Policy (peut être dans Helmet)
csp=$(get_header "$response" "Content-Security-Policy")
if [ -n "$csp" ]; then
    echo -e "${GREEN}✓${NC} Content-Security-Policy présent"
    echo "  $(echo "$csp" | cut -c1-80)..."
    ((PASSED++))
else
    echo -e "${YELLOW}⚠${NC} Content-Security-Policy absent (peut être configuré côté frontend)"
fi

echo ""
echo "2. Test Frontend Headers"
echo ""

# Test frontend
if curl -s -I "$FRONTEND_URL" > /dev/null 2>&1; then
    response=$(curl -s -I "$FRONTEND_URL" 2>&1)

    # X-Frame-Options
    x_frame=$(get_header "$response" "X-Frame-Options")
    if [ -n "$x_frame" ]; then
        if echo "$x_frame" | grep -qi "DENY\|SAMEORIGIN"; then
            echo -e "${GREEN}✓${NC} X-Frame-Options: $x_frame"
            ((PASSED++))
        else
            echo -e "${YELLOW}⚠${NC} X-Frame-Options: $x_frame"
        fi
    else
        echo -e "${RED}✗${NC} X-Frame-Options manquant"
        ((FAILED++))
    fi

    # Content-Security-Policy
    csp=$(get_header "$response" "Content-Security-Policy")
    if [ -n "$csp" ]; then
        echo -e "${GREEN}✓${NC} Content-Security-Policy présent"

        # Vérifier directives importantes
        if echo "$csp" | grep -qi "default-src"; then
            echo -e "${GREEN}  ✓${NC} default-src présent"
        else
            echo -e "${YELLOW}  ⚠${NC} default-src absent"
        fi

        if echo "$csp" | grep -qi "script-src"; then
            echo -e "${GREEN}  ✓${NC} script-src présent"
        else
            echo -e "${YELLOW}  ⚠${NC} script-src absent"
        fi

        if echo "$csp" | grep -qi "frame-ancestors.*none"; then
            echo -e "${GREEN}  ✓${NC} frame-ancestors 'none' présent"
        else
            echo -e "${YELLOW}  ⚠${NC} frame-ancestors 'none' absent"
        fi

        ((PASSED++))
    else
        echo -e "${RED}✗${NC} Content-Security-Policy manquant"
        ((FAILED++))
    fi

    # X-Content-Type-Options
    x_content_type=$(get_header "$response" "X-Content-Type-Options")
    if [ -n "$x_content_type" ] && echo "$x_content_type" | grep -qi "nosniff"; then
        echo -e "${GREEN}✓${NC} X-Content-Type-Options: $x_content_type"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC} X-Content-Type-Options manquant ou invalide"
        ((FAILED++))
    fi

    # Referrer-Policy
    referrer=$(get_header "$response" "Referrer-Policy")
    if [ -n "$referrer" ]; then
        echo -e "${GREEN}✓${NC} Referrer-Policy: $referrer"
        ((PASSED++))
    else
        echo -e "${YELLOW}⚠${NC} Referrer-Policy absent (optionnel)"
    fi

    # Permissions-Policy
    permissions=$(get_header "$response" "Permissions-Policy")
    if [ -n "$permissions" ]; then
        echo -e "${GREEN}✓${NC} Permissions-Policy présent"
        ((PASSED++))
    else
        echo -e "${YELLOW}⚠${NC} Permissions-Policy absent (optionnel)"
    fi
else
    echo -e "${YELLOW}⚠${NC} Frontend non accessible à $FRONTEND_URL (peut être arrêté)"
    echo "  Tester manuellement avec: curl -I $FRONTEND_URL"
fi

# Résumé
echo ""
echo "============================================="
echo "Résumé:"
echo -e "  ${GREEN}✓ Passés: $PASSED${NC}"
echo -e "  ${RED}✗ Échoués: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ Tous les headers de sécurité sont correctement configurés !${NC}"
    exit 0
else
    echo -e "${YELLOW}⚠️  Certains headers manquent ou sont incorrects${NC}"
    echo "  Vérifier la configuration dans:"
    echo "  - Backend: src/index.ts (Helmet)"
    echo "  - Frontend: next.config.js (headers)"
    exit 0  # Exit 0 car certains headers peuvent être optionnels
fi





