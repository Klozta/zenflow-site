-- Table pour l'historique de navigation (produits récemment consultés)
-- À exécuter dans Supabase SQL Editor

create table if not exists public.user_view_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, product_id) -- Un seul enregistrement par user+product
);

create index if not exists idx_user_view_history_user_id on public.user_view_history(user_id);
create index if not exists idx_user_view_history_product_id on public.user_view_history(product_id);
create index if not exists idx_user_view_history_viewed_at on public.user_view_history(viewed_at desc);

-- RLS Policies
alter table public.user_view_history enable row level security;

-- Users can only see their own history
create policy "Users can view own history"
  on public.user_view_history
  for select
  using (auth.uid() = user_id);

-- Users can insert their own history
create policy "Users can insert own history"
  on public.user_view_history
  for insert
  with check (auth.uid() = user_id);

-- Users can delete their own history
create policy "Users can delete own history"
  on public.user_view_history
  for delete
  using (auth.uid() = user_id);


