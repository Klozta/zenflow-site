-- Tables "ops" (audit trail + notifications) — à exécuter dans Supabase SQL Editor

-- 1) Audit des transitions de statut de commande
create table if not exists public.order_status_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text not null,
  to_status text not null,
  actor text not null, -- admin | stripe | system
  stripe_event_id text null,
  request_id text null,
  created_at timestamptz not null default now()
);

create index if not exists order_status_events_order_id_idx on public.order_status_events(order_id);
create index if not exists order_status_events_created_at_idx on public.order_status_events(created_at);

-- 2) Références Stripe côté order (dernier état connu)
create table if not exists public.stripe_order_refs (
  order_id uuid primary key references public.orders(id) on delete cascade,
  stripe_event_id text not null,
  stripe_event_type text not null,
  checkout_session_id text null,
  payment_intent_id text null,
  updated_at timestamptz not null default now()
);

-- 3) Idempotence notifications (empêche renvoi d’emails expédiée/livrée)
create table if not exists public.order_notifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  type text not null, -- shipped | delivered
  created_at timestamptz not null default now(),
  unique (order_id, type)
);


