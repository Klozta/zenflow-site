import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';

type SeedProduct = {
  title: string;
  description: string;
  price: number;
  category: string;
  stock: number;
  images: string[];
  tags: string[];
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function isPlaceholder(v: string): boolean {
  return v.includes('your_') || v.includes('here');
}

function pickSupabaseKey(): string {
  // Prefer service role key for seeding (bypasses RLS). Fallback to SUPABASE_KEY if needed.
  const candidates = [
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SERVICE_KEY,
    process.env.SUPABASE_KEY,
  ].filter(Boolean) as string[];

  if (!candidates.length) throw new Error('Missing env var: SUPABASE_KEY (or SUPABASE_SERVICE_KEY)');
  return candidates[0];
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run seed in production');
  }

  // Load backend/.env automatically when running via npm
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const envPath = path.resolve(__dirname, '../../.env');
  dotenv.config({ path: envPath });

  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseKey = pickSupabaseKey();

  if (isPlaceholder(supabaseUrl) || isPlaceholder(supabaseKey)) {
    throw new Error('Supabase not configured (placeholders detected)');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1) Users (admin + demo)
  const adminEmail = 'admin@zenflow.local';
  const demoEmail = 'demo@zenflow.local';
  const defaultPassword = 'Password123!';

  const adminHash = await bcrypt.hash(defaultPassword, 10);
  const demoHash = await bcrypt.hash(defaultPassword, 10);

  const { data: existingUsers } = await supabase
    .from('users')
    .select('id,email')
    .in('email', [adminEmail, demoEmail]);

  const existingEmails = new Set((existingUsers || []).map(u => u.email));

  const usersToInsert: Array<{ email: string; password_hash: string; name: string; role: 'admin' | 'user' }> = [];
  if (!existingEmails.has(adminEmail)) {
    usersToInsert.push({ email: adminEmail, password_hash: adminHash, name: 'Admin', role: 'admin' });
  }
  if (!existingEmails.has(demoEmail)) {
    usersToInsert.push({ email: demoEmail, password_hash: demoHash, name: 'Demo', role: 'user' });
  }

  if (usersToInsert.length) {
    const { error } = await supabase.from('users').insert(usersToInsert);
    if (error) throw error;
  }

  // 2) Products
  const products: SeedProduct[] = [
    {
      title: 'Coque iPhone Rose Gold - ZenFlow',
      description: 'Coque rose gold premium, finition brillante, protection antichoc.',
      price: 19.9,
      category: 'Coques',
      stock: 25,
      images: ['https://picsum.photos/seed/girlycoque1/900/900'],
      tags: ['rose-gold', 'iphone', 'tendance'],
    },
    {
      title: 'Bracelet Perlé Personnalisé',
      description: 'Bracelet fait main, perles + initiale. Idéal cadeau.',
      price: 14.9,
      category: 'Bijoux',
      stock: 40,
      images: ['https://picsum.photos/seed/girlybracelet/900/900'],
      tags: ['fait-main', 'cadeau', 'personnalise'],
    },
    {
      title: 'Pochette Crochet Bohème',
      description: 'Pochette crochet style bohème, doublée, fermeture zip.',
      price: 24.0,
      category: 'Crochet',
      stock: 8,
      images: ['https://picsum.photos/seed/girlycrochet1/900/900'],
      tags: ['crochet', 'boheme', 'artisanat'],
    },
    {
      title: 'Boucles d’oreilles Coeur - Rose',
      description: 'Boucles légères, coeur rose, finition douce.',
      price: 12.5,
      category: 'Bijoux',
      stock: 30,
      images: ['https://picsum.photos/seed/girlyearrings/900/900'],
      tags: ['coeur', 'rose', 'leger'],
    },
    {
      title: 'Tote bag Crochet “Noël”',
      description: 'Tote bag crochet, édition Noël, stock limité.',
      price: 29.0,
      category: 'Crochet',
      stock: 5,
      images: ['https://picsum.photos/seed/girlytote/900/900'],
      tags: ['noel', 'stock-limite', 'crochet'],
    },
  ];

  // Avoid duplicates by title
  const { data: existingProducts } = await supabase.from('products').select('id,title').in(
    'title',
    products.map(p => p.title)
  );
  const existingTitles = new Set((existingProducts || []).map(p => p.title));

  const productsToInsert = products
    .filter(p => !existingTitles.has(p.title))
    .map(p => ({
      title: p.title,
      description: p.description,
      price: p.price,
      category: p.category,
      stock: p.stock,
      images: p.images,
      tags: p.tags,
      is_deleted: false,
    }));

  if (productsToInsert.length) {
    const { error } = await supabase.from('products').insert(productsToInsert);
    if (error) throw error;
  }

  // 3) Promo codes
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const promoCodes = [
    {
      code: 'WELCOME10',
      discount_type: 'percentage',
      discount_value: 10,
      min_purchase: 20,
      max_discount: 15,
      valid_from: now.toISOString(),
      valid_until: in30.toISOString(),
      usage_limit: 200,
      is_active: true,
    },
    {
      code: 'CROCHET5',
      discount_type: 'fixed',
      discount_value: 5,
      min_purchase: 25,
      max_discount: null,
      valid_from: now.toISOString(),
      valid_until: in30.toISOString(),
      usage_limit: 100,
      is_active: true,
    },
  ];

  const { data: existingPromo } = await supabase
    .from('promo_codes')
    .select('id,code')
    .in('code', promoCodes.map(p => p.code));
  const existingPromoSet = new Set((existingPromo || []).map(p => p.code));

  const promoToInsert = promoCodes.filter(p => !existingPromoSet.has(p.code));
  if (promoToInsert.length) {
    const { error } = await supabase.from('promo_codes').insert(promoToInsert);
    if (error) throw error;
  }

  // 4) Orders (démo)
  // Récupérer les IDs des produits et utilisateurs créés
  const { data: allProducts } = await supabase.from('products').select('id,title,price').limit(5);
  const { data: allUsers } = await supabase.from('users').select('id,email').in('email', [adminEmail, demoEmail]);

  if (allProducts && allProducts.length >= 2 && allUsers && allUsers.length >= 1) {
    const demoUser = allUsers.find(u => u.email === demoEmail) || allUsers[0];
    const product1 = allProducts[0];
    const product2 = allProducts[1];

    // Générer numéro de commande
    const generateOrderNumber = () => {
      const timestamp = Date.now().toString(36).toUpperCase();
      const random = Math.random().toString(36).substring(2, 6).toUpperCase();
      return `GC-${timestamp}-${random}`;
    };

    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    // Commande 1: pending (récente)
    const order1Number = generateOrderNumber();
    const order1Id = uuidv4();
    const order1Total = (product1.price * 2) + 5; // 2 produits + shipping

    const { data: order1, error: order1Error } = await supabase
      .from('orders')
      .insert({
        id: order1Id,
        order_number: order1Number,
        user_id: demoUser.id,
        status: 'pending',
        total: order1Total,
        shipping_first_name: 'Marie',
        shipping_last_name: 'Dupont',
        shipping_email: demoEmail,
        shipping_phone: '+33612345678',
        shipping_address: '123 Rue de la Paix',
        shipping_city: 'Paris',
        shipping_postal_code: '75001',
        shipping_country: 'France',
        legal_consent_at: now.toISOString(),
        legal_consent_version: 'v1',
        created_at: now.toISOString(),
      })
      .select()
      .single();

    if (!order1Error && order1) {
      // Items pour order1
      await supabase.from('order_items').insert([
        {
          order_id: order1.id,
          product_id: product1.id,
          quantity: 2,
          unit_price: product1.price,
        },
      ]);
    }

    // Commande 2: confirmed (hier)
    const order2Number = generateOrderNumber();
    const order2Id = uuidv4();
    const order2Total = (product2.price * 1) + 5; // 1 produit + shipping

    const { data: order2, error: order2Error } = await supabase
      .from('orders')
      .insert({
        id: order2Id,
        order_number: order2Number,
        user_id: demoUser.id,
        status: 'confirmed',
        total: order2Total,
        shipping_first_name: 'Sophie',
        shipping_last_name: 'Martin',
        shipping_email: demoEmail,
        shipping_phone: '+33698765432',
        shipping_address: '45 Avenue des Champs',
        shipping_city: 'Lyon',
        shipping_postal_code: '69001',
        shipping_country: 'France',
        promo_code: 'WELCOME10',
        legal_consent_at: yesterday.toISOString(),
        legal_consent_version: 'v1',
        created_at: yesterday.toISOString(),
      })
      .select()
      .single();

    if (!order2Error && order2) {
      // Items pour order2
      await supabase.from('order_items').insert([
        {
          order_id: order2.id,
          product_id: product2.id,
          quantity: 1,
          unit_price: product2.price,
        },
      ]);
    }

    // Commande 3: shipped (il y a 2 jours)
    const order3Number = generateOrderNumber();
    const order3Id = uuidv4();
    const order3Total = (product1.price * 1 + product2.price * 1); // 2 produits, livraison gratuite (>40€)

    const { data: order3, error: order3Error } = await supabase
      .from('orders')
      .insert({
        id: order3Id,
        order_number: order3Number,
        user_id: demoUser.id,
        status: 'shipped',
        total: order3Total,
        shipping_first_name: 'Emma',
        shipping_last_name: 'Bernard',
        shipping_email: demoEmail,
        shipping_phone: '+33611223344',
        shipping_address: '78 Boulevard Saint-Michel',
        shipping_city: 'Marseille',
        shipping_postal_code: '13001',
        shipping_country: 'France',
        legal_consent_at: twoDaysAgo.toISOString(),
        legal_consent_version: 'v1',
        created_at: twoDaysAgo.toISOString(),
      })
      .select()
      .single();

    if (!order3Error && order3) {
      // Items pour order3
      await supabase.from('order_items').insert([
        {
          order_id: order3.id,
          product_id: product1.id,
          quantity: 1,
          unit_price: product1.price,
        },
        {
          order_id: order3.id,
          product_id: product2.id,
          quantity: 1,
          unit_price: product2.price,
        },
      ]);
    }

    const ordersCreated = [order1, order2, order3].filter(Boolean).length;
    console.log(`- Orders created: ${ordersCreated}`);
  }

  console.log('✅ Seed completed');
  console.log(`- Users inserted: ${usersToInsert.length}`);
  console.log(`- Products inserted: ${productsToInsert.length}`);
  console.log(`- Promo codes inserted: ${promoToInsert.length}`);
  console.log(`\nCredentials:`);
  console.log(`- admin: ${adminEmail} / ${defaultPassword}`);
  console.log(`- demo:  ${demoEmail} / ${defaultPassword}`);
}

main().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});


