// EntraPlus admin panel API. Only you can use it.
//
// Security: every request must carry a signed-in Supabase session from a MICROSOFT sign-in whose user ID is listed
// in the ADMIN_USER_IDS secret (comma-separated). Nothing else is trusted: the admin page itself has no special
// access, so a copied or modified page can't do anything. Every change is written to admin_audit.
//
// Deploy:  supabase functions deploy admin          (JWT verification stays ON)
// Secrets: ADMIN_USER_IDS (your Supabase user ID; the panel shows it if you're not on the list yet),
//          ADMIN_ORIGIN (where the panel is hosted, e.g. https://admin.entraplus.co.uk), plus the existing ones.

import { createClient } from "npm:@supabase/supabase-js@2";
import { resyncOrganisation, stripe } from "../_shared/billing.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const ADMINS = (Deno.env.get("ADMIN_USER_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ADMIN_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const DAY = 86_400_000;

class Problem extends Error { constructor(msg: string, public status = 400) { super(msg); } }

async function audit(admin: string, action: string, orgId: string | null, detail: Record<string, unknown>) {
  await db.from("admin_audit").insert({ admin, action, org_id: orgId, detail });
}

async function subscriptionOf(orgId: string) {
  const { data } = await db.from("subscriptions").select("*").eq("org_id", orgId).maybeSingle();
  return data;
}

async function fitSeats(orgId: string) {
  const { error } = await db.rpc("fit_seats", { o: orgId });
  if (error) throw error;
}

// ---------------------------------------------------------------- read
async function overview() {
  const [{ data: orgs }, { data: subs }, { data: members }, { data: invoices }] = await Promise.all([
    db.from("organisations").select("id, name, tenant_id, created_at").order("created_at", { ascending: false }),
    db.from("subscriptions").select("*"),
    db.from("members").select("org_id, status, seat, role, email, name"),
    db.from("invoices").select("id, org_id, amount, currency, status, created").order("created", { ascending: false }).limit(20),
  ]);
  const bySub = new Map((subs ?? []).map((s) => [s.org_id, s]));
  const rows = (orgs ?? []).map((o) => {
    const ms = (members ?? []).filter((m) => m.org_id === o.id && m.status !== "removed");
    const s = bySub.get(o.id);
    const expired = !!s?.current_period_end && new Date(s.current_period_end) < new Date();
    return {
      ...o, members: ms.filter((m) => m.status === "active").length, pending: ms.filter((m) => m.status === "pending").length,
      seated: ms.filter((m) => m.seat && m.status === "active").length,
      managers: ms.filter((m) => m.role === "manager" && m.status === "active").map((m) => m.email),
      seats: s?.seats ?? 0, status: expired && s?.status === "active" ? "expired" : s?.status ?? "none",
      source: s?.source ?? "stripe", period: s?.period, ends: s?.current_period_end, cancelling: s?.cancel_at_period_end,
      unit_amount: s?.unit_amount, note: s?.note,
    };
  });
  const paying = rows.filter((r) => r.status === "active" && r.source === "stripe");
  const monthly = paying.reduce((sum, r) => sum + (r.unit_amount ?? 0) * r.seats / (r.period === "yearly" ? 12 : 1), 0);
  return { organisations: rows, recent_invoices: invoices ?? [],
           totals: { organisations: rows.length, paying: paying.length, trials: rows.filter((r) => r.source === "trial" && r.status === "active").length,
                     seats: paying.reduce((n, r) => n + r.seats, 0), monthly_revenue_pence: Math.round(monthly) } };
}

async function organisation(orgId: string) {
  const [{ data: org }, sub, { data: members }, { data: invoices }, { data: log }] = await Promise.all([
    db.from("organisations").select("*").eq("id", orgId).maybeSingle(),
    subscriptionOf(orgId),
    db.from("members").select("user_id, email, name, role, status, seat, joined_at").eq("org_id", orgId).neq("status", "removed").order("joined_at"),
    db.from("invoices").select("*").eq("org_id", orgId).order("created", { ascending: false }),
    db.from("admin_audit").select("*").eq("org_id", orgId).order("at", { ascending: false }).limit(30),
  ]);
  if (!org) throw new Problem("No such organisation.", 404);
  // Every Stripe subscription tagged with this organisation, so duplicates can be spotted and cancelled.
  let stripeSubs: unknown[] = [];
  try {
    const found = await stripe.subscriptions.search({ query: `metadata['org_id']:'${orgId}'`, limit: 50 });
    stripeSubs = found.data.map((s) => ({
      id: s.id, status: s.status, created: s.created, seats: s.items.data[0]?.quantity,
      interval: s.items.data[0]?.price.recurring?.interval, cancel_at_period_end: s.cancel_at_period_end,
      current: s.id === sub?.stripe_subscription,
    }));
  } catch (err) { console.warn("Stripe search failed", err); }
  return { organisation: org, subscription: sub, members: members ?? [], invoices: invoices ?? [], stripe_subscriptions: stripeSubs, audit: log ?? [] };
}

// ---------------------------------------------------------------- licences
async function grant(admin: string, b: Record<string, any>) {
  const orgId = String(b.org_id), seats = Math.max(1, Math.min(500, Number(b.seats) || 1));
  const kind = b.kind === "trial" ? "trial" : "manual";
  const until = new Date(b.until);
  if (isNaN(until.getTime()) || until < new Date()) throw new Problem("Choose an end date in the future.");
  const sub = await subscriptionOf(orgId);
  if (sub?.source === "stripe" && sub.status === "active" && (!sub.current_period_end || new Date(sub.current_period_end) > new Date())) {
    throw new Problem("This organisation pays through Stripe. Use 'Give free time' instead, so billing stays correct.");
  }
  const { error } = await db.from("subscriptions").upsert({
    org_id: orgId, source: kind, status: "active", seats, period: null, unit_amount: null, currency: null,
    current_period_end: until.toISOString(), cancel_at_period_end: false, note: String(b.note ?? "").slice(0, 200) || null,
    stripe_subscription: null, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  await fitSeats(orgId);
  await audit(admin, kind === "trial" ? "Granted trial" : "Granted manual licence", orgId, { seats, until: until.toISOString(), note: b.note ?? "" });
  return { ok: true };
}

async function extend(admin: string, b: Record<string, any>) {
  const orgId = String(b.org_id), days = Math.max(1, Math.min(3660, Number(b.days) || 0));
  const sub = await subscriptionOf(orgId);
  if (!sub || sub.status === "none") throw new Problem("Nothing to extend: give a trial or manual licence first.");
  if (sub.source === "stripe" && sub.stripe_subscription) {
    // Free time on a paid subscription: push the next payment back with a trial period. Stripe then sends
    // customer.subscription.updated, and the webhook records the new date.
    const s = await stripe.subscriptions.retrieve(sub.stripe_subscription);
    // deno-lint-ignore no-explicit-any
    const end = ((s as any).current_period_end ?? (s.items.data[0] as any).current_period_end) as number;
    const newEnd = Math.max(end, Math.floor(Date.now() / 1000)) + days * 86400;
    await stripe.subscriptions.update(s.id, { trial_end: newEnd, proration_behavior: "none" });
    await db.from("subscriptions").update({ current_period_end: new Date(newEnd * 1000).toISOString() }).eq("org_id", orgId);
    await audit(admin, `Gave ${days} days' free time (Stripe)`, orgId, { subscription: s.id, next_payment: new Date(newEnd * 1000).toISOString() });
    return { ok: true };
  }
  const from = Math.max(new Date(sub.current_period_end ?? Date.now()).getTime(), Date.now());
  const until = new Date(from + days * DAY).toISOString();
  await db.from("subscriptions").update({ status: "active", current_period_end: until, updated_at: new Date().toISOString() }).eq("org_id", orgId);
  await fitSeats(orgId);
  await audit(admin, `Extended by ${days} days`, orgId, { until });
  return { ok: true };
}

async function setSeats(admin: string, b: Record<string, any>) {
  const orgId = String(b.org_id), seats = Math.max(0, Math.min(500, Number(b.seats) || 0));
  const sub = await subscriptionOf(orgId);
  if (sub?.source === "stripe") throw new Problem("Paid seats are changed in Stripe (the manager's billing page), not here.");
  await db.from("subscriptions").update({ seats, updated_at: new Date().toISOString() }).eq("org_id", orgId);
  await fitSeats(orgId);
  await audit(admin, `Set seats to ${seats}`, orgId, {});
  return { ok: true };
}

async function revoke(admin: string, b: Record<string, any>) {
  const orgId = String(b.org_id), when = b.when === "period_end" ? "period_end" : "now";
  const sub = await subscriptionOf(orgId);
  if (!sub) throw new Problem("No licence to remove.");
  if (sub.source === "stripe" && sub.stripe_subscription) {
    if (when === "now") await stripe.subscriptions.cancel(sub.stripe_subscription);
    else await stripe.subscriptions.update(sub.stripe_subscription, { cancel_at_period_end: true });
  }
  if (sub.source !== "stripe" || when === "now") {
    await db.from("subscriptions").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("org_id", orgId);
    await fitSeats(orgId);
  } else {
    await db.from("subscriptions").update({ cancel_at_period_end: true }).eq("org_id", orgId);
  }
  await audit(admin, when === "now" ? "Removed licence now" : "Licence set to end at period end", orgId, { source: sub.source });
  return { ok: true };
}

async function cancelStripeSubscription(admin: string, b: Record<string, any>) {
  const id = String(b.subscription);
  const s = await stripe.subscriptions.retrieve(id);
  if (s.metadata?.org_id !== b.org_id) throw new Problem("That subscription doesn't belong to this organisation.");
  await stripe.subscriptions.cancel(id);
  await audit(admin, "Cancelled a Stripe subscription", String(b.org_id), { subscription: id, seats: s.items.data[0]?.quantity });
  return { ok: true };
}

async function member(admin: string, b: Record<string, any>) {
  const patch: Record<string, unknown> = {};
  if (["manager", "senior", "technician"].includes(b.role)) patch.role = b.role;
  if (typeof b.seat === "boolean") patch.seat = b.seat;
  if (["active", "pending", "removed"].includes(b.status)) patch.status = b.status;
  const { error } = await db.from("members").update(patch).eq("org_id", b.org_id).eq("user_id", b.user_id);
  if (error) throw new Problem(error.message);
  await audit(admin, "Changed a member", String(b.org_id), { user: b.user_id, ...patch });
  return { ok: true };
}

async function resync(admin: string, b: Record<string, any>) {
  const result = await resyncOrganisation(db, String(b.org_id));
  await audit(admin, "Resynced from Stripe", String(b.org_id), { subscriptions: result.subscriptions.length, invoices: result.invoices });
  return { ok: true, subscriptions: result.subscriptions.length, invoices: result.invoices };
}

// ---------------------------------------------------------------- coupons
async function coupons() {
  const codes = await stripe.promotionCodes.list({ limit: 100, expand: ["data.coupon"] });
  return { coupons: codes.data.map((p) => ({
    id: p.id, code: p.code, active: p.active, times_redeemed: p.times_redeemed, max_redemptions: p.max_redemptions,
    expires_at: p.expires_at, first_time_only: p.restrictions?.first_time_transaction ?? false,
    percent_off: p.coupon.percent_off, amount_off: p.coupon.amount_off, duration: p.coupon.duration,
    duration_in_months: p.coupon.duration_in_months, coupon_valid: p.coupon.valid,
  })) };
}

async function createCoupon(admin: string, b: Record<string, any>) {
  const code = String(b.code ?? "").toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  const percent = Number(b.percent_off);
  if (code.length < 3) throw new Problem("Codes need at least 3 letters or numbers.");
  if (!(percent > 0 && percent <= 100)) throw new Problem("The discount must be between 1% and 100%.");
  const duration = ["once", "repeating", "forever"].includes(b.duration) ? b.duration : "once";
  const months = duration === "repeating" ? Math.max(1, Math.min(36, Number(b.duration_in_months) || 1)) : undefined;
  const expires = b.expires_at ? Math.floor(new Date(b.expires_at).getTime() / 1000) : undefined;
  if (expires && expires * 1000 < Date.now()) throw new Problem("The last day to use it must be in the future.");
  const max = Number(b.max_redemptions) > 0 ? Number(b.max_redemptions) : undefined;
  const coupon = await stripe.coupons.create({ percent_off: percent, duration, duration_in_months: months, name: `${code} (${percent}% off)`,
                                               metadata: { created_by: admin } });
  const promo = await stripe.promotionCodes.create({ coupon: coupon.id, code, expires_at: expires, max_redemptions: max,
                                                     restrictions: b.first_time_only ? { first_time_transaction: true } : undefined });
  await audit(admin, `Created coupon ${code}`, null, { percent, duration, months, expires_at: b.expires_at ?? null, max });
  return { ok: true, id: promo.id };
}

async function toggleCoupon(admin: string, b: Record<string, any>) {
  const p = await stripe.promotionCodes.update(String(b.id), { active: !!b.active });
  await audit(admin, `${b.active ? "Reactivated" : "Deactivated"} coupon ${p.code}`, null, {});
  return { ok: true };
}

async function recentAudit() {
  const { data } = await db.from("admin_audit").select("*, organisations(name)").order("at", { ascending: false }).limit(100);
  return { audit: data ?? [] };
}

// ---------------------------------------------------------------- entry
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await db.auth.getUser(jwt);
  const user = auth?.user;
  if (!user) return json({ error: "Please sign in again." }, 401);
  const viaMicrosoft = (user.identities ?? []).some((i) => i.provider === "azure") || user.app_metadata?.provider === "azure";
  if (!viaMicrosoft || !ADMINS.includes(user.id)) {
    return json({ error: "This account isn't an EntraPlus admin.", your_user_id: user.id, email: user.email }, 403);
  }
  const admin = user.email ?? user.id;
  let b: Record<string, any> = {};
  try { b = await req.json(); } catch { /* empty */ }
  try {
    switch (b.action) {
      case "whoami": return json({ email: admin, user_id: user.id });
      case "overview": return json(await overview());
      case "organisation": return json(await organisation(String(b.org_id)));
      case "grant": return json(await grant(admin, b));
      case "extend": return json(await extend(admin, b));
      case "set_seats": return json(await setSeats(admin, b));
      case "revoke": return json(await revoke(admin, b));
      case "cancel_stripe_subscription": return json(await cancelStripeSubscription(admin, b));
      case "member": return json(await member(admin, b));
      case "resync": return json(await resync(admin, b));
      case "coupons": return json(await coupons());
      case "create_coupon": return json(await createCoupon(admin, b));
      case "toggle_coupon": return json(await toggleCoupon(admin, b));
      case "audit": return json(await recentAudit());
    }
    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    console.error(err);
    const status = err instanceof Problem ? err.status : 500;
    return json({ error: (err as Error).message || "Something went wrong." }, status);
  }
});
