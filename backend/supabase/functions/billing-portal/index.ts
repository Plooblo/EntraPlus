// Opens Stripe's secure billing page for an organisation's MANAGER, already signed in (no email code),
// optionally straight at a step:
//   flow "manage"  billing details, card, invoices, renew a cancelled plan
//   flow "seats"   change the number of seats, or switch monthly <-> yearly
//   flow "cancel"  cancel the subscription (it stays active until the end of the paid period)
//
// Deploy:  supabase functions deploy billing-portal          (JWT verification stays ON)
// Secrets: STRIPE_SECRET_KEY, SITE_ORIGIN; optional STRIPE_PORTAL_CONFIG (a bpc_… ID) to choose a portal setup.

import Stripe from "npm:stripe@16";
import { createClient } from "npm:@supabase/supabase-js@2";
import { cors, json } from "../_shared/licence.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const SITE = Deno.env.get("SITE_ORIGIN") ?? "https://entraplus.co.uk";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await db.auth.getUser(jwt);
  if (!auth?.user) return json({ error: "Please sign in again." }, 401);

  const { data: m } = await db.from("members").select("org_id, role, status")
    .eq("user_id", auth.user.id).neq("status", "removed").maybeSingle();
  if (!m || m.status !== "active" || m.role !== "manager") return json({ error: "Only managers can manage billing." }, 403);

  const { data: sub } = await db.from("subscriptions").select("stripe_customer, stripe_subscription, status")
    .eq("org_id", m.org_id).maybeSingle();
  if (!sub?.stripe_customer) return json({ error: "There's no billing account yet. Choose a plan first." }, 400);

  let flow = "manage";
  try { flow = (await req.json()).flow ?? "manage"; } catch { /* no body: manage */ }

  const params: Stripe.BillingPortal.SessionCreateParams = { customer: sub.stripe_customer, return_url: `${SITE}/account.html` };
  const config = Deno.env.get("STRIPE_PORTAL_CONFIG");
  if (config) params.configuration = config;
  if ((flow === "seats" || flow === "cancel") && sub.stripe_subscription && sub.status === "active") {
    const back = { type: "redirect" as const, redirect: { return_url: `${SITE}/account.html?billing=${flow === "cancel" ? "cancelled" : "updated"}` } };
    params.flow_data = flow === "cancel"
      ? { type: "subscription_cancel", subscription_cancel: { subscription: sub.stripe_subscription }, after_completion: back }
      : { type: "subscription_update", subscription_update: { subscription: sub.stripe_subscription }, after_completion: back };
  }
  try {
    const session = await stripe.billingPortal.sessions.create(params);
    return json({ url: session.url });
  } catch (err) {
    console.error(err);
    return json({ error: "Stripe couldn't open the billing page. Please try again." }, 502);
  }
});
