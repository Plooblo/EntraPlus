// Stripe -> EntraPlus organisations.
//
// Keeps each organisation's subscription (status, seats, renewal date) and purchase history in step with
// Stripe. The account page adds the organisation's ID to the payment link as client_reference_id, which is how
// a new subscription is matched to its organisation. The rules live in ../_shared/billing.ts.
//
// Events: checkout.session.completed, customer.subscription.created, customer.subscription.updated,
//         customer.subscription.deleted, invoice.paid, invoice.payment_failed
// Deploy:  supabase functions deploy stripe-webhook --no-verify-jwt

import Stripe from "npm:stripe@16";
import { createClient } from "npm:@supabase/supabase-js@2";
import { invoiceSubscription, recordInvoice, stripe, syncSubscription } from "../_shared/billing.ts";

const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

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
        if (s.mode === "subscription" && s.subscription) await syncSubscription(db, s.subscription as string, s.client_reference_id);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(db, (event.data.object as Stripe.Subscription).id);
        break;
      case "invoice.paid":
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const subId = invoiceSubscription(inv);
        if (subId) await syncSubscription(db, subId);
        await recordInvoice(db, inv);
        break;
      }
    }
  } catch (err) {
    console.error(err);
    return new Response(`Error: ${(err as Error).message}`, { status: 500 });   // Stripe retries later
  }
  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
