-- EntraPlus: where is the database setup up to? Run in Supabase > SQL Editor. Changes nothing.
with t(name) as (values ('organisations'), ('members'), ('subscriptions'), ('invoices'), ('app_codes'), ('app_sessions'), ('admin_audit'), ('invites'), ('trial_tenants'))
select 1 as ord, 'Table ' || t.name as check,
  case when c.oid is null then '!! missing: run schema.sql' || case when t.name = 'trial_tenants' then ' or update-trial.sql' else '' end
       when not c.relrowsecurity then '!! row level security is OFF'
       when t.name = 'admin_audit' and has_table_privilege('authenticated', 'public.admin_audit', 'SELECT') then '!! signed-in users can read the audit log'
       when t.name = 'trial_tenants' and has_table_privilege('authenticated', 'public.trial_tenants', 'SELECT') then '!! signed-in users can read trial_tenants'
       when not has_table_privilege('service_role', 'public.' || t.name, 'INSERT') then '!! server role blocked: run fix-permissions.sql / update-admin.sql'
       else 'OK' end as result
from t left join pg_class c on c.relname = t.name and c.relnamespace = 'public'::regnamespace
union all
select 2, 'Function ' || f, case when to_regprocedure('public.' || f) is null then '!! missing: run update-admin.sql and update-invites.sql'
  when not has_function_privilege('service_role', 'public.' || f, 'EXECUTE') then '!! server role blocked: run fix-permissions.sql'
  else 'OK' end
from unnest(array['account_state()', 'create_organisation(text)', 'join_organisation()', 'fit_seats(uuid)',
                  'end_app_session(uuid)', 'prune_app_auth()', 'licence_active(uuid)', 'org_domains(uuid)']) f
union all
select 3, 'Latest sign-in: ' || u.email,
  coalesce('tenant ' || coalesce(u.raw_user_meta_data -> 'custom_claims' ->> 'tid',
             substring(u.raw_user_meta_data ->> 'iss' from 'microsoftonline\.com/([0-9a-fA-F-]{36})')),
           '!! no tenant ID found: send this row''s raw_user_meta_data to Claude')
from (select * from auth.users order by created_at desc limit 1) u
union all
select 4, 'Organisation ' || o.name,
  (select count(*) from members m where m.org_id = o.id and m.status = 'active') || ' active, ' ||
  (select count(*) from members m where m.org_id = o.id and m.status = 'pending') || ' waiting, ' ||
  (select count(*) from members m where m.org_id = o.id and m.seat) || ' seated | subscription ' ||
  coalesce(s.status, 'none') || coalesce(' ' || nullif(s.source, 'stripe'), '') ||
  coalesce(', ' || s.seats || ' seats' || coalesce(' ' || s.period, ''), '') ||
  coalesce(' until ' || to_char(s.current_period_end, 'DD Mon YYYY'), '') ||
  coalesce(' (' || s.stripe_subscription || ')', '')
from organisations o left join subscriptions s on s.org_id = o.id
union all
select 5, 'Automatic trial', case
  when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'amount')
    then '!! subscriptions.amount missing: run update-trial.sql'
  when to_regclass('public.trial_tenants') is null or position('trial_tenants' in pg_get_functiondef('public.create_organisation(text)'::regprocedure)) = 0
    then '!! new organisations don''t get a trial yet: run update-trial.sql'
  else 'OK' end
union all
select 5, 'Invoices recorded', count(*)::text from invoices
union all
select 6, 'App sessions (signed-in PCs)', count(*) filter (where not revoked) || ' active' from app_sessions
order by 1, 2;
