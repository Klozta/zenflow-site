# Guide d'activation des features "Ops" (audit trail + emails status)

## 1. Tables SQL (Supabase)

Exécute le fichier `ops_tables.sql` dans **Supabase SQL Editor** :

```bash
# Copier le contenu de:
backend/src/scripts/ops_tables.sql
```

Ou via CLI Supabase :
```bash
supabase db execute -f backend/src/scripts/ops_tables.sql
```

**Tables créées :**
- `order_status_events` : audit des transitions (qui/quoi/quand)
- `stripe_order_refs` : références Stripe par commande (event_id, payment_intent, etc.)
- `order_notifications` : idempotence emails (shipped/delivered)

**Note :** Si les tables n'existent pas encore, tout fonctionne en "best-effort" (non-bloquant).

## 2. Test du login admin (cookie httpOnly)

### Backend
Les routes `/api/admin/*` sont déjà montées dans `index.ts`.

### Frontend
1. Va sur `/admin/orders` ou `/admin/metrics`
2. Saisis ton `CRON_API_KEY` ou `ADMIN_TOKEN` dans le champ "Token admin"
3. Clique sur "Se connecter"
4. Un cookie `admin_session` (httpOnly) est créé → plus besoin de ressaisir

**Compatibilité :** Les endpoints acceptent toujours `x-cron-key` en header (legacy), mais le cookie est préféré.

## 3. Emails automatiques "expédiée" / "livrée"

Quand tu changes le statut d'une commande via `/admin/orders` :
- `confirmed → shipped` → email "📦 Commande expédiée" envoyé (idempotent)
- `shipped → delivered` → email "✅ Commande livrée" envoyé (idempotent)

**Idempotence :** Via table `order_notifications` (si dispo), sinon best-effort.

## 4. Audit trail

Toutes les transitions de statut sont enregistrées dans `order_status_events` :
- **Actor** : `admin` (via UI), `stripe` (webhook), `system` (futur)
- **Stripe refs** : stockées dans `stripe_order_refs` (dernier event connu)

**Utile pour :**
- SAV (qui a changé quoi, quand)
- Anti-fraude (traçabilité Stripe)
- Debug (request_id pour corréler logs)

## 5. Vérification rapide

```bash
# Backend
cd backend && npm run lint && npm run type-check

# Frontend
cd frontend && npm run lint && npm run build:stable
```

Tout doit passer ✅


