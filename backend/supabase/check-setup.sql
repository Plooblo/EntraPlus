-- EntraPlus: where is the database setup up to? Run in Supabase > SQL Editor. Changes nothing.
with t(name) as (values ('organisations'), ('members'), ('subscriptions'), ('invoices'), ('app_codes'), ('app_sessions'))
select 1 as ord, 'Table ' || t.name as check,
  case when c.oid is null then '!! missing: run schema.sql'
       when not c.relrowsecurity then '!! row level security is OFF'
       when not has_table_privilege('service_role', 'public.' || t.name, 'INSERT') then '!! server role blocked: run fix-permissions.sql'
       else 'OK' end as result
from t left join pg_class c on c.relname = t.name and c.relnamespace = 'public'::regnamespace
union all
select 2, 'Function ' || f, case when to_regprocedure('public.' || f) is null then '!! missing: run schema.sql'
  when not has_function_privilege('service_role', 'public.' || f, 'EXECUTE') then '!! server role blocked: run fix-permissions.sql'
  else 'OK' end
from unnest(array['account_state()', 'create_organisation(text)', 'join_organisation()', 'fit_seats(uuid)',
                  'end_app_session(uuid)', 'prune_app_auth()']) f
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
  coalesce(s.status, 'none') || coalesce(', ' || s.seats || ' seats ' || s.period, '') ||
  coalesce(' until ' || to_char(s.current_period_end, 'DD Mon YYYY'), '') ||
  coalesce(' (' || s.stripe_subscription || ')', '')
from organisations o left join subscriptions s on s.org_id = o.id
union all
select 5, 'Invoices recorded', count(*)::text from invoices
union all
select 6, 'App sessions (signed-in PCs)', count(*) filter (where not revoked) || ' active' from app_sessions
order by 1, 2;
