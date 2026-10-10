// Keeping an organisation's subscription and purchase history in step with Stripe.
// Used by the Stripe webhook (one event at a time) and the admin panel's "Resync from Stripe" (everything at once),
// so both follow exactly the same rules.
import Stripe from "npm:stripe@16";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", { apiVersion: "2024-06-20" });

function periodEnd(sub: Stripe.Subscription): number {
  // Newer Stripe API versions moved current_period_end onto the subscription item.
  // deno-lint-ignore no-explicit-any
  return (sub as any).current_period_end ?? (sub.items.data[0] as any)?.current_period_end;
}

// Stripe's newer API versions moved an invoice's subscription to invoice.parent.subscription_details.subscription.
// deno-lint-ignore no-explicit-any
export function invoiceSubscription(inv: any): string | null {
  const direct = typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;
  return direct ?? inv.parent?.subscription_details?.subscription
    ?? inv.lines?.data?.[0]?.parent?.subscription_item_details?.subscription ?? null;
}

export function statusOf(sub: Stripe.Subscription): "active" | "past_due" | "cancelled" {
  if (sub.status === "active" || sub.status === "trialing") return "active";
  if (sub.status === "past_due" || sub.status === "unpaid" || sub.status === "incomplete") return "past_due";
  return "cancelled";
}

export async function orgFor(db: SupabaseClient, subId: string, customerId: string, hint?: string | null): Promise<string | null> {
  if (hint) return hint;
  const bySub = await db.from("subscriptions").select("org_id").eq("stripe_subscription", subId).maybeSingle();
  if (bySub.data) return bySub.data.org_id;
  const byCustomer = await db.from("subscriptions").select("org_id").eq("stripe_customer", customerId).maybeSingle();
  if (byCustomer.data) return byCustomer.data.org_id;
  const sub = await stripe.subscriptions.retrieve(subId);       // every subscription we've seen is tagged
  return sub.metadata?.org_id || null;
}

/** Bring one Stripe subscription into the organisation's record. Safe in any order, any number of times. */
export async function syncSubscription(db: SupabaseClient, subId: string, orgHint?: string | null): Promise<string | null> {
  const sub = await stripe.subscriptions.retrieve(subId);
  const customer = sub.customer as string;
  const orgId = await orgFor(db, sub.id, customer, orgHint ?? (sub.metadata?.org_id || null));
  if (!orgId) {
    console.warn(`No organisation for subscription ${sub.id}. Was client_reference_id set on the payment link?`);
    return null;
  }
  if (sub.metadata?.org_id !== orgId) await stripe.subscriptions.update(sub.id, { metadata: { ...sub.metadata, org_id: orgId } });

  // Never let one subscription overwrite another that's active, and never let an old or cancelled Stripe
  // subscription overwrite an active trial or manual licence. A NEW active purchase does take over.
  const { data: current } = await db.from("subscriptions").select("stripe_subscription, status, source")
    .eq("org_id", orgId).maybeSingle();
  if (current?.status === "active" && current.stripe_subscription !== sub.id) {
    if (statusOf(sub) !== "active") {
      console.log(`Ignoring ${sub.id} (${sub.status}): organisation ${orgId} has an active licence`);
      return orgId;
    }
    if (current.source === "stripe" && current.stripe_subscription) {
      const other = await stripe.subscriptions.retrieve(current.stripe_subscription);
      if (statusOf(other) === "active") {
        console.warn(`Organisation ${orgId} has two active subscriptions (${other.id}, ${sub.id}). Cancel one in Stripe.`);
        if (other.created > sub.created) return orgId;
      }
    }
  }
  const item = sub.items.data[0];
  const { error } = await db.from("subscriptions").upsert({
    org_id: orgId,
    source: "stripe",
    note: null,
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
  const fit = await db.rpc("fit_seats", { o: orgId });
  if (fit.error) throw fit.error;
  return orgId;
}

/** Save one invoice to the organisation's purchase history. */
export async function recordInvoice(db: SupabaseClient, inv: Stripe.Invoice, orgHint?: string): Promise<void> {
  const subId = invoiceSubscription(inv);
  if (!subId) return;
  const orgId = orgHint ?? await orgFor(db, subId, inv.customer as string);
  if (!orgId) return;
  const line = inv.lines.data[0];
  // deno-lint-ignore no-explicit-any
  const interval = (line as any)?.price?.recurring?.interval
    ?? (await db.from("subscriptions").select("period").eq("org_id", orgId).maybeSingle()).data?.period;
  const { error } = await db.from("invoices").upsert({
    id: inv.id, org_id: orgId, number: inv.number, status: inv.status, amount: inv.total, currency: inv.currency,
    seats: line?.quantity ?? null,
    period: interval === "year" || interval === "yearly" ? "yearly" : "monthly",
    created: new Date(inv.created * 1000).toISOString(),
    hosted_url: inv.hosted_invoice_url, pdf_url: inv.invoice_pdf,
  });
  if (error) throw error;
}

/** Everything Stripe knows about an organisation: its subscriptions (found by tag) and all their invoices. */
export async function resyncOrganisation(db: SupabaseClient, orgId: string): Promise<{ subscriptions: Stripe.Subscription[]; invoices: number }> {
  const found = await stripe.subscriptions.search({ query: `metadata['org_id']:'${orgId}'`, limit: 100 });
  const subs = found.data.sort((a, b) => a.created - b.created);
  // Oldest first, so the newest active subscription ends up as the current one.
  for (const s of subs) await syncSubscription(db, s.id, orgId);
  let invoices = 0;
  for (const s of subs) {
    for await (const inv of stripe.invoices.list({ subscription: s.id, limit: 100 })) {
      await recordInvoice(db, inv, orgId);
      invoices += 1;
    }
  }
  return { subscriptions: subs, invoices };
}
