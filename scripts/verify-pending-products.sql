-- 📊 Vérification et création table pending_products
-- À exécuter dans Supabase SQL Editor si la table n'existe pas

-- ============================================
-- VÉRIFICATION
-- ============================================
-- Vérifier si la table existe
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'pending_products'
ORDER BY ordinal_position;

-- ============================================
-- CRÉATION (si nécessaire)
-- ============================================
CREATE TABLE IF NOT EXISTS pending_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('aliexpress', 'image', 'manual')),
  source_url TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  original_price DECIMAL(10,2),
  category TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  images TEXT[] DEFAULT '{}',
  specifications JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejected_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  approved_at TIMESTAMP WITH TIME ZONE
);

-- ============================================
-- INDEXES pour performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_pending_products_status ON pending_products(status);
CREATE INDEX IF NOT EXISTS idx_pending_products_created_at ON pending_products(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pending_products_source ON pending_products(source);
CREATE INDEX IF NOT EXISTS idx_pending_products_category ON pending_products(category);

-- ============================================
-- RLS POLICIES
-- ============================================
ALTER TABLE pending_products ENABLE ROW LEVEL SECURITY;

-- Policy: Service role peut tout faire (admin)
DROP POLICY IF EXISTS "Service role can manage pending products" ON pending_products;
CREATE POLICY "Service role can manage pending products" ON pending_products FOR ALL
USING (auth.role() = 'service_role');

-- ============================================
-- VÉRIFICATION FINALE
-- ============================================
SELECT
  'Table pending_products créée avec succès' as status,
  COUNT(*) as total_pending
FROM pending_products
WHERE status = 'pending';





