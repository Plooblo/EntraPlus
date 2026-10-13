-- =====================================================================================
-- EntraPlus: invites (October 2026). Run once in Supabase > SQL Editor; safe to re-run.
--
-- A manager invites colleagues by email. Invites are only accepted for the organisation's own email domains
-- (the domains its members have signed in with through Microsoft), and the invited person must still sign in
-- with Microsoft FROM THE ORGANISATION'S TENANT to join. An invite skips the "waiting for approval" step and
-- gives them the role the manager chose.
-- =====================================================================================

create table if not exists public.invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations (id) on delete cascade,
  email       text not null,
  role        text not null default 'technician' check (role in ('manager', 'senior', 'technician')),
  invited_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days',
  accepted_at timestamptz,
  emailed     boolean not null default false
);
create unique index if not exists invites_one_open on public.invites (org_id, lower(email)) where accepted_at is null;

alter table public.invites enable row level security;
drop policy if exists invites_read on public.invites;
drop policy if exists invites_cancel on public.invites;
create policy invites_read   on public.invites for select to authenticated using (public.is_manager(org_id));
create policy invites_cancel on public.invites for delete to authenticated using (public.is_manager(org_id));
revoke all on public.invites from anon, authenticated;
grant select, delete on public.invites to authenticated;
grant select, insert, update, delete on public.invites to service_role;

-- The email domains an organisation may invite: those its active members signed in with (verified by Microsoft).
create or replace function public.org_domains(o uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct lower(split_part(email, '@', 2))) filter (where email like '%@%'), '{}')
  from members where org_id = o and status = 'active';
$$;
grant execute on function public.org_domains(uuid) to authenticated, service_role;

-- Joining now honours invites: an invited person joins straight away, with the role they were invited as.
create or replace function public.join_organisation() returns text
language plpgsql security definer set search_path = public, auth as $$
declare
  t text := public.my_tenant(); o_id uuid; o_name text; u_email text; u_name text; inv_id uuid; inv_role text;
begin
  if auth.uid() is null or t is null then return null; end if;
  select id, name into o_id, o_name from organisations where tenant_id = t;
  if o_id is null then return null; end if;
  select email, coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', '')
    into u_email, u_name from auth.users where id = auth.uid();
  select id, role into inv_id, inv_role from invites
   where org_id = o_id and lower(email) = lower(u_email) and accepted_at is null and expires_at > now()
   order by created_at desc limit 1;
  insert into members (org_id, user_id, email, name, role, status)
    values (o_id, auth.uid(), u_email, u_name, coalesce(inv_role, 'technician'), case when inv_id is null then 'pending' else 'active' end)
    on conflict (org_id, user_id) do update
      set status = excluded.status, role = excluded.role, seat = false
      where members.status = 'removed' or (members.status = 'pending' and excluded.status = 'active');
  if inv_id is not null then update invites set accepted_at = now() where id = inv_id; end if;
  return o_name;
end $$;
grant execute on function public.join_organisation() to authenticated, service_role;
