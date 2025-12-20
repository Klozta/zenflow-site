-- Table pour les abonnements push notifications
-- À exécuter dans Supabase SQL Editor

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh_key text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user_id on public.push_subscriptions(user_id);
create index if not exists idx_push_subscriptions_endpoint on public.push_subscriptions(endpoint);

-- RLS Policies
alter table public.push_subscriptions enable row level security;

-- Users can view their own subscriptions
create policy "Users can view own subscriptions"
  on public.push_subscriptions
  for select
  using (auth.uid() = user_id);

-- Users can insert their own subscriptions
create policy "Users can insert own subscriptions"
  on public.push_subscriptions
  for insert
  with check (auth.uid() = user_id);

-- Users can delete their own subscriptions
create policy "Users can delete own subscriptions"
  on public.push_subscriptions
  for delete
  using (auth.uid() = user_id);
