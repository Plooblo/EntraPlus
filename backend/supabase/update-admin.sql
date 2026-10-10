-- =====================================================================================
-- EntraPlus: admin panel support (October 2026). Run once in Supabase > SQL Editor; safe to re-run.
--
-- Adds:
--   subscriptions.source   where an organisation's Pro comes from: stripe | trial | manual
--   subscriptions.note     your note for trials and manual licences ("Bett show trial", "Partner school")
--   admin_audit            every admin panel action: who did what, to which organisation, when
-- and makes the account page treat a licence whose end date has passed as expired.
-- =====================================================================================

alter table public.subscriptions add column if not exists source text not null default 'stripe';
alter table public.subscriptions add column if not exists note text;
do $$ begin
  alter table public.subscriptions add constraint subscriptions_source_check check (source in ('stripe', 'trial', 'manual'));
exception when duplicate_object then null; end $$;

create table if not exists public.admin_audit (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  admin      text not null,            -- the admin's email
  action     text not null,
  org_id     uuid references public.organisations (id) on delete set null,
  detail     jsonb not null default '{}'::jsonb
);
alter table public.admin_audit enable row level security;      -- no policies: only the admin function reads it
revoke all on public.admin_audit from anon, authenticated;
grant select, insert on public.admin_audit to service_role;

-- A licence whose end date has passed doesn't count, wherever it came from (trials and manual licences
-- have no Stripe events to switch them off). Seats stay assigned so they come back if it's extended.
create or replace function public.licence_active(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from subscriptions where org_id = o and status = 'active'
                 and (current_period_end is null or current_period_end > now()));
$$;
grant execute on function public.licence_active(uuid) to authenticated, service_role;

-- account_state now also tells the website header your seat and licence status
create or replace function public.account_state() returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare
  t text := public.my_tenant();
  m_org uuid; m_role text; m_status text; m_seat boolean;
  o_id uuid; o_name text;
begin
  select org_id, role, status, seat into m_org, m_role, m_status, m_seat
    from members where user_id = auth.uid() and status <> 'removed' limit 1;
  if m_org is not null then
    select id, name into o_id, o_name from organisations where id = m_org;
  elsif t is not null then
    select id, name into o_id, o_name from organisations where tenant_id = t;
  end if;
  return json_build_object(
    'tenant', t,
    'org', case when o_id is null then null else json_build_object('id', o_id, 'name', o_name) end,
    'member', case when m_org is null then null
                   else json_build_object('role', m_role, 'status', m_status, 'seat', m_seat,
                                          'pro', m_seat and m_status = 'active' and public.licence_active(m_org)) end,
    'managers', coalesce((select json_agg(coalesce(nullif(name, ''), email)) from members
                          where org_id = o_id and role = 'manager' and status = 'active'), '[]'::json)
  );
end $$;
grant execute on function public.account_state() to authenticated, service_role;
