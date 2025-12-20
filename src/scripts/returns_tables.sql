-- Tables pour la gestion des retours/remboursements
-- À exécuter dans Supabase SQL Editor

create table if not exists public.return_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'refunded', 'completed')),
  items jsonb not null, -- [{ orderItemId, quantity, reason }]
  total_refund numeric(10, 2) not null default 0,
  stripe_refund_id text,
  admin_notes text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  refunded_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_return_requests_order_id on public.return_requests(order_id);
create index if not exists idx_return_requests_user_id on public.return_requests(user_id);
create index if not exists idx_return_requests_status on public.return_requests(status);
create index if not exists idx_return_requests_created_at on public.return_requests(created_at desc);

-- RLS Policies
alter table public.return_requests enable row level security;

-- Users can view their own returns
create policy "Users can view own returns"
  on public.return_requests
  for select
  using (auth.uid() = user_id);

-- Users can create their own returns
create policy "Users can create own returns"
  on public.return_requests
  for insert
  with check (auth.uid() = user_id);

-- Function to increment product stock (for returns)
create or replace function increment_product_stock(
  product_id uuid,
  quantity integer
) returns void as $$
begin
  update public.products
  set stock = stock + quantity
  where id = product_id;
end;
$$ language plpgsql security definer;


