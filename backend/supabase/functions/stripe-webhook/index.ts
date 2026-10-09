// Stripe -> EntraPlus licence keys.
//
// Stripe calls this after a payment. It works out how long the customer has paid for,
// signs a licence key in exactly the format the desktop app checks
// (base64url(JSON payload) + "." + base64url(Ed25519 signature)), and saves it to the
// licences table, where the account page shows it.
//
// Events to send from Stripe: checkout.session.completed, invoice.paid,
// customer.subscription.updated, customer.subscription.deleted
//
// Deploy:  supabase functions deploy stripe-webhook --no-verify-jwt

import Stripe from "npm:stripe@16";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const PERIOD_BY_PRICE: Record<string, "monthly" | "yearly"> = {
  [Deno.env.get("STRIPE_PRICE_MONTHLY") ?? "unset-monthly"]: "monthly",
  [Deno.env.get("STRIPE_PRICE_YEARLY") ?? "unset-yearly"]: "yearly",
};
const GRACE_DAYS = 3; // keys stay valid a few days past renewal, so a slow payment never locks anyone out

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

// ---------- licence signing (must match entraplus/licensing/licence.py) ----------
const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let keyPromise: Promise<CryptoKey> | null = null;
function signingKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    const pem = Deno.env.get("LICENCE_PRIVATE_KEY_PEM")!;
    const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
    keyPromise = crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"]);
  }
  return keyPromise;
}

export async function makeLicenceKey(p: { licenceId: string; email: string; period: string; expires: string }): Promise<string> {
  const payload = {
    product: "entraplus",
    licence_id: p.licenceId,
    email: p.email,
    plan: "pro",
    period: p.period,
    issued: new Date().toISOString().slice(0, 10),
    expires: p.expires,
  };
  const payloadB64 = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", await signingKey(), enc.encode(payloadB64)));
  return `${payloadB64}.${b64url(sig)}`;
}

// ---------- helpers ----------
function periodEnd(sub: Stripe.Subscription): number {
  // Newer Stripe API versions moved current_period_end onto the subscription item.
  // deno-lint-ignore no-explicit-any
  return (sub as any).current_period_end ?? (sub.items.data[0] as any)?.current_period_end;
}

function statusOf(sub: Stripe.Subscription): "active" | "past_due" | "cancelled" {
  if (sub.status === "active" || sub.status === "trialing") return "active";
  if (sub.status === "past_due" || sub.status === "unpaid" || sub.status === "incomplete") return "past_due";
  return "cancelled";
}

async function saveFromSubscription(subId: string, userId?: string | null) {
  const sub = await stripe.subscriptions.retrieve(subId);
  const customer = (await stripe.customers.retrieve(sub.customer as string)) as Stripe.Customer;
  const priceId = sub.items.data[0]?.price.id ?? "";
  const period = PERIOD_BY_PRICE[priceId] ?? (sub.items.data[0]?.price.recurring?.interval === "year" ? "yearly" : "monthly");
  const end = new Date((periodEnd(sub) + GRACE_DAYS * 86400) * 1000).toISOString().slice(0, 10);
  const status = statusOf(sub);

  // Find the existing row (renewals), or create one for the user who checked out.
  let { data: row } = await db.from("licences").select("*").eq("stripe_subscription", subId).maybeSingle();
  if (!row && userId) {
    ({ data: row } = await db.from("licences").select("*").eq("user_id", userId).maybeSingle());
  }
  const uid = row?.user_id ?? userId;
  if (!uid) throw new Error(`No EntraPlus user for subscription ${subId}. Was client_reference_id set on the payment link?`);

  const licenceId = row?.licence_id ?? crypto.randomUUID().replace(/-/g, "");
  const email = customer.email ?? row?.email ?? "";
  // Only issue a new key while the subscription is paid up; a cancelled one keeps its last key until it expires.
  const licenceKey = status === "active"
    ? await makeLicenceKey({ licenceId, email, period, expires: end })
    : row?.licence_key ?? null;

  const { error } = await db.from("licences").upsert({
    user_id: uid,
    email,
    plan: "pro",
    period,
    status,
    expires: status === "active" ? end : row?.expires ?? end,
    licence_id: licenceId,
    licence_key: licenceKey,
    stripe_customer: customer.id,
    stripe_subscription: subId,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

// ---------- webhook ----------
Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, WEBHOOK_SECRET, undefined,
                                                      Stripe.createSubtleCryptoProvider());
  } catch (err) {
    return new Response(`Bad signature: ${(err as Error).message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.mode === "subscription" && s.subscription) {
          await saveFromSubscription(s.subscription as string, s.client_reference_id);
        }
        break;
      }
      case "invoice.paid": {
        const inv = event.data.object as Stripe.Invoice;
        if (inv.subscription) await saveFromSubscription(inv.subscription as string);
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await saveFromSubscription(sub.id);
        break;
      }
    }
  } catch (err) {
    console.error(err);
    // A 500 makes Stripe retry later, which is what we want if the database was briefly unavailable.
    return new Response(`Error: ${(err as Error).message}`, { status: 500 });
  }
  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
