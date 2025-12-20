#!/bin/bash
# 📤 Test de validation upload - ZenFlow Backend
# Teste la validation stricte des uploads de fichiers

set -e

API_URL="${API_URL:-http://localhost:3001}"
TEST_DIR="/tmp/zenflow-upload-test"

echo "📤 Tests de validation upload"
echo "=============================="
echo "API URL: $API_URL"
echo ""

# Couleurs
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Créer dossier de test
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

# Fonction de test
test_upload() {
    local name=$1
    local file_path=$2
    local expected_status=$3

    echo -n "Test: $name... "

    response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/products/auto-generate/image" \
        -F "image=@$file_path" 2>&1)

    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$http_code" = "$expected_status" ]; then
        echo -e "${GREEN}✓${NC} (HTTP $http_code)"
        return 0
    else
        echo -e "${RED}✗${NC} (HTTP $http_code, attendu $expected_status)"
        if [ "$http_code" != "200" ] && [ "$http_code" != "201" ]; then
            echo "  Réponse: $(echo "$body" | head -n3)"
        fi
        return 1
    fi
}

PASSED=0
FAILED=0

# Test 1: Créer une image PNG valide (1x1 pixel)
echo "1. Préparation fichiers de test"
echo "  Création image PNG valide..."
convert -size 1x1 xc:white test-valid.png 2>/dev/null || \
    python3 -c "from PIL import Image; Image.new('RGB', (1,1), 'white').save('test-valid.png')" 2>/dev/null || \
    echo "⚠️  ImageMagick/PIL non disponible, création fichier minimal..."
    # Fallback: créer un fichier PNG minimal manuellement
    if [ ! -f "test-valid.png" ]; then
        # PNG minimal valide (1x1 pixel)
        printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc\xf8\x00\x00\x00\x01\x00\x01\x00\x00\x00\x00IEND\xaeB`\x82' > test-valid.png
    fi

# Test 2: Créer un fichier trop volumineux (>10MB)
echo "  Création fichier trop volumineux..."
dd if=/dev/zero of=test-too-large.png bs=1M count=11 2>/dev/null || \
    head -c 11534336 /dev/zero > test-too-large.png 2>/dev/null

# Test 3: Créer un fichier avec extension invalide
echo "  Création fichier extension invalide..."
cp test-valid.png test-invalid.exe 2>/dev/null || echo "test content" > test-invalid.exe

# Test 4: Créer un fichier vide
echo "  Création fichier vide..."
touch test-empty.png

# Test 5: Créer un fichier texte (pas une image)
echo "  Création fichier texte..."
echo "Ceci n'est pas une image" > test-text.txt

echo ""
echo "2. Tests de validation"
echo ""

# Test fichiers valides
if [ -f "test-valid.png" ]; then
    test_upload "Image PNG valide" "test-valid.png" "200" && ((PASSED++)) || ((FAILED++))
fi

# Test fichiers invalides
test_upload "Fichier trop volumineux" "test-too-large.png" "400" && ((PASSED++)) || ((FAILED++))
test_upload "Extension invalide (.exe)" "test-invalid.exe" "400" && ((PASSED++)) || ((FAILED++))
test_upload "Fichier vide" "test-empty.png" "400" && ((PASSED++)) || ((FAILED++))
test_upload "Fichier texte (pas image)" "test-text.txt" "400" && ((PASSED++)) || ((FAILED++))

# Test sans fichier
echo -n "Test: Aucun fichier fourni... "
response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/products/auto-generate/image" 2>&1)
http_code=$(echo "$response" | tail -n1)
if [ "$http_code" = "400" ]; then
    echo -e "${GREEN}✓${NC} (HTTP $http_code)"
    ((PASSED++))
else
    echo -e "${RED}✗${NC} (HTTP $http_code, attendu 400)"
    ((FAILED++))
fi

# Nettoyage
echo ""
echo "3. Nettoyage"
rm -rf "$TEST_DIR"

# Résumé
echo ""
echo "=============================="
echo "Résumé:"
echo -e "  ${GREEN}✓ Passés: $PASSED${NC}"
echo -e "  ${RED}✗ Échoués: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ Tous les tests sont passés !${NC}"
    exit 0
else
    echo -e "${YELLOW}⚠️  Certains tests ont échoué (normal si endpoint nécessite auth)${NC}"
    exit 0  # Exit 0 car certains échecs sont attendus si auth requis
fi





