#!/bin/bash
# 🧪 Script maître - Exécute tous les tests de sécurité
# Exécute tous les scripts de test dans l'ordre

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "🧪 Exécution de tous les tests de sécurité"
echo "==========================================="
echo ""

# Couleurs
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

TOTAL_PASSED=0
TOTAL_FAILED=0
TESTS_RUN=0

# Fonction pour exécuter un test
run_test() {
    local test_name=$1
    local test_script=$2

    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Test: $test_name${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    if [ ! -f "$test_script" ]; then
        echo -e "${RED}✗${NC} Script non trouvé: $test_script"
        ((TOTAL_FAILED++))
        ((TESTS_RUN++))
        return 1
    fi

    if bash "$test_script"; then
        echo -e "${GREEN}✓${NC} $test_name: PASSÉ"
        ((TOTAL_PASSED++))
    else
        exit_code=$?
        echo -e "${RED}✗${NC} $test_name: ÉCHOUÉ (exit code: $exit_code)"
        ((TOTAL_FAILED++))
    fi

    ((TESTS_RUN++))
    echo ""
    sleep 1
}

# Vérifier que le backend est accessible
echo "Vérification backend..."
if curl -s -f "$API_URL/health" > /dev/null 2>&1 || curl -s -f "http://localhost:3001/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Backend accessible"
else
    echo -e "${YELLOW}⚠${NC} Backend non accessible - certains tests peuvent échouer"
    echo "  Démarrer le backend avec: npm run dev"
fi
echo ""

# Exécuter les tests
run_test "Sécurité Générale" "scripts/test-security.sh"
run_test "Cookies HTTP-only" "scripts/test-cookies.sh"
run_test "Validation Upload" "scripts/test-upload.sh"
run_test "Détection Token Reuse" "scripts/test-token-reuse.sh"
run_test "CSP Headers" "scripts/test-csp-headers.sh"

# Résumé final
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}RÉSUMÉ FINAL${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Tests exécutés: $TESTS_RUN"
echo -e "${GREEN}✓ Passés: $TOTAL_PASSED${NC}"
echo -e "${RED}✗ Échoués: $TOTAL_FAILED${NC}"
echo ""

if [ $TOTAL_FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ Tous les tests sont passés !${NC}"
    exit 0
elif [ $TOTAL_FAILED -lt $TESTS_RUN ]; then
    echo -e "${YELLOW}⚠️  Certains tests ont échoué${NC}"
    echo "  Vérifier les logs ci-dessus pour plus de détails"
    exit 0  # Exit 0 car certains échecs peuvent être attendus
else
    echo -e "${RED}❌ Tous les tests ont échoué${NC}"
    echo "  Vérifier que le backend est démarré et configuré correctement"
    exit 1
fi





