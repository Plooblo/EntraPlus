-- =====================================================================================
-- EntraPlus: automatic 30-day Pro trial, and new prices (October 2026).
-- Run once in Supabase > SQL Editor; safe to re-run. Run it BEFORE deploying the updated functions.
--
-- Trial
--   The first person from a Microsoft tenant sets up the organisation and it gets a 30-day Pro trial for up to
--   5 technicians straight away, with no card. The manager gets the first seat and can give the other four out.
--   It's once per TENANT, not per person: trial_tenants remembers every tenant that has had one, so signing in
--   with another account from the same tenant, or setting the organisation up again, never starts a new trial.
--   When the trial ends, licence_active() stops counting it and everyone drops to the read-only Free plan.
--   Buying seats in Stripe replaces the trial (stripe-webhook already does this).
--
-- Prices
--   Yearly is now tiered in Stripe (5 seats for £1,000, then £240 each), so a price no longer has one
--   unit_amount. subscriptions.amount holds the whole subscription's price per period, in pence before VAT.
-- =====================================================================================

create table if not exists public.trial_tenants (
  tenant_id   text primary key,                                   -- Microsoft Entra tenant ID (tid)
  org_id      uuid references public.organisations (id) on delete set null,
  started_at  timestamptz not null default now(),
  ends_at     timestamptz not null
);
alter table public.trial_tenants enable row level security;      -- no policies: only the server reads it
revoke all on public.trial_tenants from anon, authenticated;
grant select, insert, update, delete on public.trial_tenants to service_role;

-- Organisations that already exist have had their chance (or are paying): no automatic trial for them.
insert into public.trial_tenants (tenant_id, org_id, started_at, ends_at)
  select tenant_id, id, created_at, created_at from public.organisations where tenant_id is not null
  on conflict (tenant_id) do nothing;

alter table public.subscriptions add column if not exists amount integer;   -- pence per period, all seats, before VAT

-- The first person from a tenant sets the organisation up, becomes its manager and, the first time that
-- tenant is ever seen, starts the organisation's free trial with a seat for themselves.
create or replace function public.create_organisation(org_name text) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare
  t text := public.my_tenant(); new_id uuid; u_email text; u_name text; trial boolean;
  trial_days constant integer := 30;
  trial_seats constant integer := 5;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if t is null then
    raise exception 'Sign in with your work or school Microsoft account to set up an organisation.';
  end if;
  if exists (select 1 from members where user_id = auth.uid() and status <> 'removed') then
    raise exception 'You already belong to an organisation on EntraPlus.';
  end if;
  if exists (select 1 from organisations where tenant_id = t) then
    raise exception 'Your organisation is already on EntraPlus. Your manager can approve you from their dashboard.';
  end if;
  select email, coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', '')
    into u_email, u_name from auth.users where id = auth.uid();
  insert into organisations (name, tenant_id, created_by) values (trim(org_name), t, auth.uid()) returning id into new_id;

  insert into trial_tenants (tenant_id, org_id, ends_at) values (t, new_id, now() + make_interval(days => trial_days))
    on conflict (tenant_id) do nothing;
  trial := found;
  if trial then
    insert into subscriptions (org_id, source, status, seats, current_period_end, note)
      values (new_id, 'trial', 'active', trial_seats, now() + make_interval(days => trial_days),
              trial_days || '-day free trial');
  else
    insert into subscriptions (org_id) values (new_id);
  end if;
  insert into members (org_id, user_id, email, name, role, status, seat)
    values (new_id, auth.uid(), u_email, u_name, 'manager', 'active', trial);
  return new_id;
end $$;

grant execute on function public.create_organisation(text) to authenticated, service_role;
