
-- User-submitted X handles for article discovery.
-- Users can submit their handle; admins approve via status field.
-- The ingest cron reads approved handles alongside the hardcoded seed list.
create table public.seed_accounts (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique,
  submitted_by uuid references public.profiles(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  high_yield boolean not null default false,
  articles_found integer not null default 0,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for the ingest cron query
create index idx_seed_accounts_approved on public.seed_accounts (status) where status = 'approved';

-- RLS
alter table public.seed_accounts enable row level security;

-- Anyone can read approved accounts
create policy "approved accounts are public"
  on public.seed_accounts for select
  using (status = 'approved');

-- Authenticated users can submit handles
create policy "authenticated users can submit handles"
  on public.seed_accounts for insert
  to authenticated
  with check (submitted_by = auth.uid());

-- Admins can do everything
create policy "admins full access"
  on public.seed_accounts for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  );

-- Seed the existing confirmed writers
insert into public.seed_accounts (handle, status, high_yield, articles_found) values
  ('Decentralisedco', 'approved', true, 8),
  ('NotBatmanDev', 'approved', false, 1),
  ('DefiIgnas', 'approved', false, 1),
  ('CryptoCred', 'approved', false, 1),
  ('Rewkang', 'approved', false, 1),
  ('tokenterminal', 'approved', false, 1),
  ('sierracatalina', 'approved', false, 2),
  ('RyanHoliday', 'approved', true, 6),
  ('drjimfan', 'approved', false, 1);
