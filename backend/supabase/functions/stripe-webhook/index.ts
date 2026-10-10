// Stripe -> EntraPlus organisations.
//
// Keeps each organisation's subscription (status, seats, renewal date) and purchase history
// in step with Stripe. The account page adds the organisation's ID to the payment link as
// client_reference_id, which is how a new subscription is matched to the organisation.
//
// Events to send from Stripe:
//   checkout.session.completed, customer.subscription.created, customer.subscription.updated,
//   customer.subscription.deleted, invoice.paid, invoice.payment_failed
//
// Deploy:  supabase functions deploy stripe-webhook --no-verify-jwt

import Stripe from "npm:stripe@16";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

function periodEnd(sub: Stripe.Subscription): number {
  // Newer Stripe API versions moved current_period_end onto the subscription item.
  // deno-lint-ignore no-explicit-any
  return (sub as any).current_period_end ?? (sub.items.data[0] as any)?.current_period_end;
}

// Stripe's newer API versions (2025-03 onwards, which new webhook endpoints use) moved an invoice's
// subscription to invoice.parent.subscription_details.subscription. Accept both layouts.
// deno-lint-ignore no-explicit-any
function invoiceSubscription(inv: any): string | null {
  const direct = typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;
  return direct ?? inv.parent?.subscription_details?.subscription
    ?? inv.lines?.data?.[0]?.parent?.subscription_item_details?.subscription ?? null;
}

function statusOf(sub: Stripe.Subscription): "active" | "past_due" | "cancelled" {
  if (sub.status === "active" || sub.status === "trialing") return "active";
  if (sub.status === "past_due" || sub.status === "unpaid" || sub.status === "incomplete") return "past_due";
  return "cancelled";
}

async function orgFor(subId: string, customerId: string, hint?: string | null): Promise<string | null> {
  if (hint) return hint;
  const bySub = await db.from("subscriptions").select("org_id").eq("stripe_subscription", subId).maybeSingle();
  if (bySub.data) return bySub.data.org_id;
  const byCustomer = await db.from("subscriptions").select("org_id").eq("stripe_customer", customerId).maybeSingle();
  if (byCustomer.data) return byCustomer.data.org_id;
  // Every subscription we've seen is tagged with its organisation, even ones that aren't the current one.
  const sub = await stripe.subscriptions.retrieve(subId);
  return sub.metadata?.org_id || null;
}

async function syncSubscription(subId: string, orgHint?: string | null): Promise<string | null> {
  const sub = await stripe.subscriptions.retrieve(subId);
  const customer = sub.customer as string;
  const orgId = await orgFor(sub.id, customer, orgHint ?? (sub.metadata?.org_id || null));
  if (!orgId) {
    console.warn(`No organisation for subscription ${sub.id}. Was client_reference_id set on the payment link?`);
    return null;
  }
  // Tag the subscription with its organisation first, so its invoices can always be matched.
  if (sub.metadata?.org_id !== orgId) await stripe.subscriptions.update(sub.id, { metadata: { ...sub.metadata, org_id: orgId } });

  // Stripe retries failed events for days and they can arrive in any order, so always decide from the
  // subscription's CURRENT state (retrieved above), and never let one subscription overwrite another
  // that is active. If an organisation somehow has two active subscriptions, the newest one counts.
  const { data: current } = await db.from("subscriptions").select("stripe_subscription, status")
    .eq("org_id", orgId).maybeSingle();
  if (current?.stripe_subscription && current.stripe_subscription !== sub.id && current.status === "active") {
    if (statusOf(sub) !== "active") {
      console.log(`Ignoring ${sub.id} (${sub.status}): organisation ${orgId} has active ${current.stripe_subscription}`);
      return orgId;
    }
    const other = await stripe.subscriptions.retrieve(current.stripe_subscription);
    if (statusOf(other) === "active") {
      console.warn(`Organisation ${orgId} has two active subscriptions (${other.id}, ${sub.id}). Cancel one in Stripe.`);
      if (other.created > sub.created) return orgId;
    }
  }
  const item = sub.items.data[0];
  const { error } = await db.from("subscriptions").upsert({
    org_id: orgId,
    stripe_customer: customer,
    stripe_subscription: sub.id,
    status: statusOf(sub),
    period: item?.price.recurring?.interval === "year" ? "yearly" : "monthly",
    seats: item?.quantity ?? 0,
    unit_amount: item?.price.unit_amount ?? null,
    currency: item?.price.currency ?? null,
    current_period_end: new Date(periodEnd(sub) * 1000).toISOString(),
    cancel_at_period_end: sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  // Fewer seats than people seated? Take seats back (managers keep theirs). New purchase? Seat the manager.
  const fit = await db.rpc("fit_seats", { o: orgId });
  if (fit.error) throw fit.error;
  return orgId;
}

async function recordInvoice(inv: Stripe.Invoice): Promise<void> {
  const subId = invoiceSubscription(inv);
  if (!subId) return;
  const orgId = await orgFor(subId, inv.customer as string);
  if (!orgId) return;
  const line = inv.lines.data[0];
  // deno-lint-ignore no-explicit-any
  const interval = (line as any)?.price?.recurring?.interval
    ?? (await db.from("subscriptions").select("period").eq("org_id", orgId).maybeSingle()).data?.period;
  const { error } = await db.from("invoices").upsert({
    id: inv.id,
    org_id: orgId,
    number: inv.number,
    status: inv.status,
    amount: inv.total,
    currency: inv.currency,
    seats: line?.quantity ?? null,
    period: interval === "year" || interval === "yearly" ? "yearly" : "monthly",
    created: new Date(inv.created * 1000).toISOString(),
    hosted_url: inv.hosted_invoice_url,
    pdf_url: inv.invoice_pdf,
  });
  if (error) throw error;
}

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
        if (s.mode === "subscription" && s.subscription) await syncSubscription(s.subscription as string, s.client_reference_id);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription((event.data.object as Stripe.Subscription).id);
        break;
      case "invoice.paid":
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const subId = invoiceSubscription(inv);
        if (subId) await syncSubscription(subId);
        await recordInvoice(inv);
        break;
      }
    }
  } catch (err) {
    console.error(err);
    return new Response(`Error: ${(err as Error).message}`, { status: 500 });   // Stripe retries later
  }
  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
