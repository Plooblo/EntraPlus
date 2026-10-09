-- EntraPlus accounts: run once in Supabase > SQL Editor.
-- Profiles (name, organisation) live in each user's auth metadata, so only licences need a table.

create table if not exists public.licences (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  email               text not null,
  plan                text not null default 'pro',
  period              text check (period in ('monthly', 'yearly')),
  status              text not null default 'active' check (status in ('active', 'past_due', 'cancelled')),
  expires             date,
  licence_id          text not null default replace(gen_random_uuid()::text, '-', ''),
  licence_key         text,
  stripe_customer     text,
  stripe_subscription text unique,
  updated_at          timestamptz not null default now()
);

alter table public.licences enable row level security;

-- Signed-in customers can read their own row, and nothing else.
drop policy if exists "Read own licence" on public.licences;
create policy "Read own licence" on public.licences
  for select to authenticated using (auth.uid() = user_id);

-- There are deliberately no insert, update or delete policies:
-- only the Stripe webhook (which uses the service role key) can write licences.
