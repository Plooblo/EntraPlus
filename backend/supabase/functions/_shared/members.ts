// Who someone is in EntraPlus, and their licence key if they have a Pro seat.
// Used by member-licence (the account page) and app-auth (the desktop app), so both always agree.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { makeLicenceKey } from "./licence.ts";

const GRACE_DAYS = 3;

export interface Standing {
  profile: { name: string; email: string; org: string; role: string; status: string; seat: boolean };
  licence: { key: string; expires: string } | null;
  reason: string;               // why there's no licence, in words the person can act on
}

export async function standing(db: SupabaseClient, userId: string): Promise<Standing> {
  const { data: auth } = await db.auth.admin.getUserById(userId);
  const u = auth?.user;
  const meta = (u?.user_metadata ?? {}) as Record<string, string>;
  const out: Standing = {
    profile: { name: meta.full_name || meta.name || "", email: u?.email ?? "", org: "", role: "", status: "", seat: false },
    licence: null,
    reason: "",
  };
  const { data: m } = await db.from("members").select("org_id, role, status, seat, email, name")
    .eq("user_id", userId).neq("status", "removed").maybeSingle();
  if (!m) {
    out.reason = "You're not part of an organisation on EntraPlus yet. Sign in at entraplus.co.uk to set one up or join yours.";
    return out;
  }
  const { data: org } = await db.from("organisations").select("name").eq("id", m.org_id).maybeSingle();
  out.profile = { ...out.profile, name: m.name || out.profile.name, email: m.email || out.profile.email,
                  org: org?.name ?? "", role: m.role, status: m.status, seat: m.seat };
  if (m.status !== "active") { out.reason = "Your manager hasn't approved your account yet."; return out; }
  if (!m.seat) { out.reason = "You don't have a Pro seat. Ask your EntraPlus manager for one."; return out; }

  const { data: sub } = await db.from("subscriptions").select("status, period, current_period_end, source")
    .eq("org_id", m.org_id).maybeSingle();
  if (!sub || sub.status !== "active" || !sub.current_period_end || new Date(sub.current_period_end) < new Date()) {
    out.reason = sub?.source === "trial" && sub.status === "active"
      ? "Your organisation's EntraPlus trial has ended. Your manager can buy seats to keep Pro."
      : "Your organisation's EntraPlus subscription isn't active. Your manager can check Billing.";
    return out;
  }
  const end = new Date(sub.current_period_end);
  end.setUTCDate(end.getUTCDate() + GRACE_DAYS);
  const expires = end.toISOString().slice(0, 10);
  const key = await makeLicenceKey({ licenceId: `${m.org_id}:${userId}`, email: out.profile.email,
                                     period: sub.source === "trial" ? "trial" : sub.period ?? "monthly", expires,
                                     org: m.org_id, role: m.role });
  out.licence = { key, expires };
  return out;
}
