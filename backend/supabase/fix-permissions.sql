-- =====================================================================================
-- EntraPlus: permissions fix (October 2026)
--
-- Run this once in Supabase > SQL Editor. It's safe to run more than once.
--
-- Why: since May 2026, new Supabase projects don't automatically let the server role
-- (service_role, used by the Stripe webhook and the app sign-in) into new tables. The
-- original schema only granted the signed-in website role, so the webhook was refused
-- with "permission denied for table subscriptions" and purchases never reached your
-- organisation. This grants exactly what the server functions need, and makes the
-- signed-in role's access explicit too.
-- =====================================================================================

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
