// Gives a signed-in technician their licence key, if their manager has given them a Pro seat
// and the organisation's subscription is active. The key expires a few days after the paid
// period ends; each renewal means a fresh key (the app will fetch it automatically later).
//
// Deploy:  supabase functions deploy member-licence
// (JWT verification stays ON: only signed-in people can call it.)

import { createClient } from "npm:@supabase/supabase-js@2";
import { cors, json, makeLicenceKey } from "../_shared/licence.ts";

const GRACE_DAYS = 3;
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await db.auth.getUser(jwt);
  const user = auth?.user;
  if (!user) return json({ error: "Please sign in again." }, 401);

  const { data: m } = await db.from("members").select("org_id, role, status, seat, email, name")
    .eq("user_id", user.id).neq("status", "removed").maybeSingle();
  if (!m || m.status !== "active") return json({ error: "Your manager hasn't approved your account yet." }, 403);
  if (!m.seat) return json({ error: "You don't have a Pro seat yet. Ask your EntraPlus manager to give you one." }, 403);

  const { data: sub } = await db.from("subscriptions").select("status, period, current_period_end")
    .eq("org_id", m.org_id).maybeSingle();
  if (!sub || sub.status !== "active" || !sub.current_period_end) {
    return json({ error: "Your organisation's EntraPlus subscription isn't active. Your manager can check Billing." }, 403);
  }
  const end = new Date(sub.current_period_end);
  end.setUTCDate(end.getUTCDate() + GRACE_DAYS);
  const expires = end.toISOString().slice(0, 10);
  const key = await makeLicenceKey({
    licenceId: `${m.org_id}:${user.id}`, email: m.email || user.email || "", period: sub.period ?? "monthly",
    expires, org: m.org_id, role: m.role,
  });
  return json({ key, expires, role: m.role });
});
