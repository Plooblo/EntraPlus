# Accounts and payments backend

GitHub Pages only serves static files, so accounts and payments need two free/low-cost services:

- **Supabase** handles sign-up, log-in and password resets, and stores each customer's licence. The free tier is plenty to start.
- **Stripe** takes payment and handles subscriptions, renewals, receipts, VAT and cancellations.

Here is how the pieces connect:

1. A customer creates an account on your site (Supabase).
2. They choose Pro and pay through a Stripe Payment Link. The account page adds their user ID to the link, so you know who paid.
3. Stripe tells `stripe-webhook` (a Supabase Edge Function) about the payment.
4. The function signs a licence key with your private key and saves it in the `licences` table.
5. The account page shows the key, with Reveal and Copy buttons. Each renewal issues a fresh key with a new expiry date. A cancelled subscription keeps working until the paid period ends.

I tested the key-signing code: keys it produces are accepted by the desktop app's own checker. The rest hasn't been run against live Supabase and Stripe accounts, so go through the test-mode steps below first.

## 1. Supabase

1. Create a project at supabase.com (choose a London region).
2. **SQL Editor:** paste and run `supabase/schema.sql`.
3. **Authentication > URL Configuration:**
   - Site URL: `https://entraplus.co.uk`
   - Redirect URLs: `https://entraplus.co.uk/account.html`
4. **Authentication > Emails:** edit the confirmation and reset emails to sound like EntraPlus. Before launch, connect your own SMTP service (e.g. Resend, or your Microsoft 365 mailbox). The built-in sender is heavily rate-limited.
5. **Project Settings > API:** copy the Project URL and the `anon` public key into `assets/js/config.js`, and set `auth.mode` to `"supabase"`. The anon key is designed to be public; the table's security rules stop anyone reading someone else's licence.

## 2. Stripe

Do all of this in **Test mode** first.

1. **Products:** create "EntraPlus Pro" with two prices: £15 monthly and £120 yearly. Note each price ID (`price_…`).
2. **Payment Links:** make one per price. Under "After payment", redirect to `https://entraplus.co.uk/account.html`. Paste both link URLs into `config.js` under `stripe.monthly` and `stripe.yearly`.
3. **Customer portal** (Settings > Billing > Customer portal): turn it on, allow cancelling and switching plans, and paste its login link into `stripe.portal`.
4. **Developers > Webhooks:** add an endpoint.
   - URL: `https://YOUR-PROJECT.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy its signing secret (`whsec_…`).
5. **Tax:** Stripe Tax can work out VAT once you register. Speak to an accountant about when that applies.

## 3. Deploy the webhook

You'll need the [Supabase CLI](https://supabase.com/docs/guides/cli). From this `backend` folder:

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF

supabase secrets set STRIPE_SECRET_KEY=sk_test_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
supabase secrets set STRIPE_PRICE_MONTHLY=price_...
supabase secrets set STRIPE_PRICE_YEARLY=price_...
supabase secrets set LICENCE_PRIVATE_KEY_PEM="$(cat ../../EntraPlus/tools/keys/private_key.pem)"

supabase functions deploy stripe-webhook --no-verify-jwt
```

`--no-verify-jwt` is needed because Stripe, not a signed-in user, calls the function. Instead, the function checks Stripe's signature on every request.

`LICENCE_PRIVATE_KEY_PEM` must come from the same key pair whose public half is built into the app (`python tools/licence_tool.py keygen` in the EntraPlus project). This is the only place the private key should ever live, apart from your offline backup.

## 4. Test it end to end

1. Register on your site with a real email address, confirm it, and log in.
2. Choose Pro monthly and pay with Stripe's test card `4242 4242 4242 4242` (any future date, any CVC).
3. Back on the account page, the plan shows Pro and Reveal shows a key.
4. Paste the key into EntraPlus (Account and settings > Enter a licence key). It should activate.
5. In Stripe, cancel the subscription. The account page should show the plan as cancelled once the period ends.

If a key doesn't appear, Stripe > Webhooks shows each delivery and its response, and Supabase > Edge Functions > Logs shows the function's errors.

When everything works, repeat steps 2 to 4 of the Stripe setup in Live mode and update the secrets and links.

## Later: automatic activation in the app

The app's `LicenceManager.refresh_online()` is the hook for signing in to the app with an EntraPlus account. The simplest version is a second Edge Function that takes the user's Supabase session token and returns their current `licence_key`, so the app can fetch it without copy and paste.
