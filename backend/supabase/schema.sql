-- =====================================================================================
-- EntraPlus accounts, organisations, seats and billing
-- Run once in Supabase > SQL Editor (safe to re-run: it drops and recreates policies).
--
-- Model
--   organisations  one per Microsoft tenant (school or business)
--   members        people in an organisation, with a role and maybe a Pro seat
--   subscriptions  the organisation's Stripe subscription      (managers only, written by the webhook)
--   invoices       purchase history                            (managers only, written by the webhook)
--
-- Roles
--   manager     buys and manages EntraPlus; sees billing; approves people; sets roles and seats
--   senior      senior technician: may use advanced mode in the app
--   technician  basic mode only
-- =====================================================================================

create extension if not exists pgcrypto;

-- If you ran the earlier single-user schema, it's no longer used.
drop table if exists public.licences cascade;

create table if not exists public.organisations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 2 and 120),
  tenant_id   text unique,                  -- Microsoft Entra tenant ID (tid)
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  org_id     uuid not null references public.organisations (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  email      text not null default '',
  name       text not null default '',
  role       text not null default 'technician' check (role in ('manager', 'senior', 'technician')),
  status     text not null default 'pending'    check (status in ('pending', 'active', 'removed')),
  seat       boolean not null default false,
  joined_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);
create unique index if not exists members_one_org_per_person on public.members (user_id) where status <> 'removed';

create table if not exists public.subscriptions (
  org_id               uuid primary key references public.organisations (id) on delete cascade,
  stripe_customer      text unique,
  stripe_subscription  text unique,
  status               text not null default 'none' check (status in ('none', 'active', 'past_due', 'cancelled')),
  period               text check (period in ('monthly', 'yearly')),
  seats                integer not null default 0,
  unit_amount          integer,                 -- pence per seat
  currency             text,
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at           timestamptz not null default now()
);

create table if not exists public.invoices (
  id           text primary key,                 -- Stripe invoice ID
  org_id       uuid not null references public.organisations (id) on delete cascade,
  number       text,
  status       text,
  amount       integer,                          -- pence, total including tax
  currency     text,
  seats        integer,
  period       text,
  created      timestamptz,
  hosted_url   text,
  pdf_url      text
);

-- ------------------------------------------------------------------ who am I?
-- The Microsoft tenant of the signed-in person, read from Supabase's own copy of the verified
-- Microsoft sign-in (never from anything the browser sends). Supabase versions store it in
-- different places, so check each.
create or replace function public.my_tenant() returns text
language sql stable security definer set search_path = public, auth as $$
  select nullif(coalesce(
    (select u.raw_user_meta_data -> 'custom_claims' ->> 'tid' from auth.users u where u.id = auth.uid()),
    (select i.identity_data -> 'custom_claims' ->> 'tid' from auth.identities i
       where i.user_id = auth.uid() and i.provider = 'azure' limit 1),
    (select substring(u.raw_user_meta_data ->> 'iss' from 'login\.microsoftonline\.com/([0-9a-fA-F-]{36})')
       from auth.users u where u.id = auth.uid()),
    (select substring(i.identity_data ->> 'iss' from 'login\.microsoftonline\.com/([0-9a-fA-F-]{36})')
       from auth.identities i where i.user_id = auth.uid() and i.provider = 'azure' limit 1)
  ), '9188040d-6c67-4c5b-b112-36a304b66dad');   -- personal Microsoft accounts don't count as an organisation
$$;

create or replace function public.is_member(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where org_id = o and user_id = auth.uid() and status = 'active');
$$;

create or replace function public.is_manager(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where org_id = o and user_id = auth.uid() and status = 'active' and role = 'manager');
$$;

-- ------------------------------------------------------------------ what the account page needs
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
                   else json_build_object('role', m_role, 'status', m_status, 'seat', m_seat) end,
    'managers', coalesce((select json_agg(coalesce(nullif(name, ''), email)) from members
                          where org_id = o_id and role = 'manager' and status = 'active'), '[]'::json)
  );
end $$;

-- The first person from a tenant sets the organisation up and becomes its manager.
create or replace function public.create_organisation(org_name text) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare
  t text := public.my_tenant(); new_id uuid; u_email text; u_name text;
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
  insert into subscriptions (org_id) values (new_id);
  insert into members (org_id, user_id, email, name, role, status) values (new_id, auth.uid(), u_email, u_name, 'manager', 'active');
  return new_id;
end $$;

-- Everyone else from the same tenant joins as "waiting for approval".
create or replace function public.join_organisation() returns text
language plpgsql security definer set search_path = public, auth as $$
declare
  t text := public.my_tenant(); o_id uuid; o_name text; u_email text; u_name text;
begin
  if auth.uid() is null or t is null then return null; end if;
  select id, name into o_id, o_name from organisations where tenant_id = t;
  if o_id is null then return null; end if;
  select email, coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', '')
    into u_email, u_name from auth.users where id = auth.uid();
  insert into members (org_id, user_id, email, name, role, status)
    values (o_id, auth.uid(), u_email, u_name, 'technician', 'pending')
    on conflict (org_id, user_id) do update set status = 'pending', seat = false where members.status = 'removed';
  return o_name;
end $$;

-- ------------------------------------------------------------------ rules that always hold
create or replace function public.members_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare used integer; allowed integer; managers integer;
begin
  if tg_op = 'DELETE' or new.status <> 'active' or new.role <> 'manager' then
    if (tg_op = 'DELETE' or old.role = 'manager') and old.status = 'active' then
      select count(*) into managers from members
        where org_id = old.org_id and role = 'manager' and status = 'active' and user_id <> old.user_id;
      if managers = 0 then raise exception 'Every organisation needs at least one manager.'; end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.status <> 'active' then new.seat := false; end if;
  if new.seat and (tg_op = 'INSERT' or not old.seat or old.status <> 'active') then
    select coalesce(seats, 0) into allowed from subscriptions where org_id = new.org_id and status = 'active';
    select count(*) into used from members
      where org_id = new.org_id and seat and status = 'active' and user_id <> new.user_id;
    if used >= coalesce(allowed, 0) then
      raise exception 'All % Pro seats are in use. Add seats from Billing, or take a seat from someone else first.', coalesce(allowed, 0);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists members_rules on public.members;
create trigger members_rules before insert or update or delete on public.members
  for each row execute function public.members_rules();

-- Used by the Stripe webhook when seats are reduced: keep managers' seats first, then the longest-standing.
create or replace function public.fit_seats(o uuid) returns void
language plpgsql security definer set search_path = public as $$
declare allowed integer;
begin
  select case when status = 'active' then seats else 0 end into allowed from subscriptions where org_id = o;
  update members set seat = false
   where org_id = o and user_id in (
     select user_id from members where org_id = o and seat and status = 'active'
     order by (role = 'manager') desc, joined_at asc offset coalesce(allowed, 0));
  -- the purchaser gets a seat automatically if one is free
  if coalesce(allowed, 0) > (select count(*) from members where org_id = o and seat and status = 'active') then
    update members set seat = true
     where org_id = o and user_id = (select user_id from members where org_id = o and role = 'manager'
                                     and status = 'active' and not seat order by joined_at limit 1);
  end if;
end $$;

-- ------------------------------------------------------------------ row level security
alter table public.organisations enable row level security;
alter table public.members       enable row level security;
alter table public.subscriptions enable row level security;
alter table public.invoices      enable row level security;

drop policy if exists org_read on public.organisations;
drop policy if exists org_rename on public.organisations;
create policy org_read   on public.organisations for select to authenticated using (public.is_member(id));
create policy org_rename on public.organisations for update to authenticated
  using (public.is_manager(id)) with check (public.is_manager(id));

drop policy if exists members_read on public.members;
drop policy if exists members_manage on public.members;
create policy members_read   on public.members for select to authenticated
  using (user_id = auth.uid() or public.is_manager(org_id));
create policy members_manage on public.members for update to authenticated
  using (public.is_manager(org_id)) with check (public.is_manager(org_id));

drop policy if exists subs_read on public.subscriptions;
create policy subs_read on public.subscriptions for select to authenticated using (public.is_manager(org_id));

drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices for select to authenticated using (public.is_manager(org_id));

-- Column-level limits: managers can rename the organisation and change role, status and seat, nothing else.
revoke all on public.organisations, public.members, public.subscriptions, public.invoices from anon, authenticated;
grant select on public.organisations, public.members, public.subscriptions, public.invoices to authenticated;
grant update (name) on public.organisations to authenticated;
grant update (role, status, seat) on public.members to authenticated;

revoke all on function public.fit_seats(uuid) from public, anon, authenticated;
grant execute on function public.account_state(), public.create_organisation(text), public.join_organisation(),
  public.my_tenant() to authenticated;

-- =====================================================================================
-- Desktop app sign-in
--   app_codes     one-time codes that hand a website sign-in to the app (5 minutes, single use, PKCE-bound)
--   app_sessions  each signed-in PC; the app holds a long random token, we only store its SHA-256 hash
-- Only the app-auth server function (service role) writes these. People can see and end their own sessions.
-- =====================================================================================
create table if not exists public.app_codes (
  code_hash   text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  challenge   text not null,
  expires_at  timestamptz not null,
  used        boolean not null default false
);

create table if not exists public.app_sessions (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique,
  user_id     uuid not null references auth.users (id) on delete cascade,
  device      text not null default '',
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  revoked     boolean not null default false
);

alter table public.app_codes    enable row level security;
alter table public.app_sessions enable row level security;
revoke all on public.app_codes, public.app_sessions from anon, authenticated;

drop policy if exists own_sessions_read on public.app_sessions;
create policy own_sessions_read on public.app_sessions for select to authenticated using (user_id = auth.uid());
grant select (id, device, created_at, last_seen, revoked) on public.app_sessions to authenticated;

create or replace function public.end_app_session(session_id uuid) returns void
language sql security definer set search_path = public as $$
  update app_sessions set revoked = true where id = session_id and user_id = auth.uid();
$$;
grant execute on function public.end_app_session(uuid) to authenticated;

-- Tidy-up: expired codes and sessions unused for 90 days (the app-auth function also calls this).
create or replace function public.prune_app_auth() returns void
language sql security definer set search_path = public as $$
  delete from app_codes where expires_at < now() - interval '1 day';
  delete from app_sessions where revoked or last_seen < now() - interval '90 days';
$$;
revoke all on function public.prune_app_auth() from public, anon, authenticated;

-- ------------------------------------------------------------------ server role access
-- Supabase projects created after May 2026 don't grant API roles access to new tables automatically,
-- so everything the server functions need is granted explicitly here.
grant usage on schema public to service_role, authenticated;

-- Server functions (Stripe webhook, member-licence, app-auth) read and write everything.
grant select, insert, update, delete on
  public.organisations, public.members, public.subscriptions, public.invoices,
  public.app_codes, public.app_sessions
to service_role;

grant execute on function
  public.fit_seats(uuid), public.prune_app_auth(),
  public.account_state(), public.my_tenant(), public.is_member(uuid), public.is_manager(uuid),
  public.create_organisation(text), public.join_organisation(), public.end_app_session(uuid)
to service_role;

-- Signed-in website users: unchanged rules, just stated explicitly so nothing depends on defaults.
grant execute on function
  public.account_state(), public.my_tenant(), public.is_member(uuid), public.is_manager(uuid),
  public.create_organisation(text), public.join_organisation(), public.end_app_session(uuid)
to authenticated;

-- ------------------------------------------------------------------ admin panel (trials, manual licences, audit)
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
