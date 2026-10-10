# EntraPlus accounts: Microsoft sign-in, organisations and billing

This sets up the account system end to end:

1. People sign in on entraplus.co.uk with their **Microsoft work or school account**. There are no passwords to manage.
2. The first person from a Microsoft tenant **sets up the organisation** and becomes its **manager**.
3. Anyone else from the same tenant who signs in **joins automatically as "waiting for approval"**. They appear in the manager's dashboard.
4. The manager approves people, sets their **role** and decides who gets a **Pro seat**:
   - **Manager:** billing and people.
   - **Senior technician:** may use advanced mode.
   - **Technician:** basic mode only.
5. Only managers see the subscription, renewal or expiry date, prices and purchase history.
6. The manager buys seats with **Stripe** (£15 per technician a month or £120 a year). Seat changes, plan switches, card updates, invoices and cancelling all happen on Stripe's secure billing page.
7. Anyone with a seat reveals their **licence key** on the account page. Keys expire 3 days after the paid period ends, and renewals issue fresh ones.

The pieces:

- **The website** stays on GitHub Pages.
- **Supabase** handles Microsoft sign-in, the database and two small server functions.
- **Stripe** takes the money.

The website's demo mode lets you try every screen in a browser before any of this exists.

What has been tested:

- **The database:** the organisation rules were run against a real PostgreSQL database. That covered setting up, joining, approving, the seat limit, the always-one-manager rule, who can see billing, and seat reductions.
- **The website:** every screen was clicked through in a browser with automated accessibility checks.
- **Licence keys:** the key format matches the app; an earlier key produced by the same signing code was accepted by the desktop app.
- **Not yet tested:** the parts that need your accounts. These are the Microsoft sign-in itself, the two server functions running on Supabase, and the Stripe webhook. Step 7 walks through testing them.

---

## Already done in Stripe (test mode, "EntraPlus sandbox")

| What | ID |
|---|---|
| Product: EntraPlus Pro (unit: technician) | `prod_VPb5nkEPEuzFKF` |
| Monthly price: £15 per technician | `price_1UOltUFPvb7T5luTBx3oCxR7` (lookup key `entraplus_pro_monthly`) |
| Yearly price: £120 per technician | `price_1UOltXFPvb7T5luTDe3NPAEL` (lookup key `entraplus_pro_yearly`) |
| Monthly payment link (buyer picks 1 to 100 seats) | https://buy.stripe.com/test_bJeaEXeoh2gi9BWg0w7Vm00 |
| Yearly payment link (buyer picks 1 to 100 seats) | https://buy.stripe.com/test_3cI00j4NHf34cO801y7Vm01 |
| Customer portal (seats, plan switch, card, invoices, cancel at period end) | `bpc_1UOluSFPvb7T5luT6MPpOeuD` |
| Portal sign-in link | https://billing.stripe.com/p/login/test_bJeaEXeoh2gi9BWg0w7Vm00 |

These links are already in `assets/js/config.js`. After payment, Stripe sends people back to `/account.html?paid=1`.

**Two things to confirm before going live:**

- **Stripe Managed Payments is switched on.** Stripe acts as the seller of record and handles VAT and sales tax worldwide, which saves you registering for VAT in other countries. Fees are higher than standard Stripe, and invoices are issued by Stripe. If you'd rather be the seller yourself, turn it off in Stripe under Settings > Managed Payments and use Stripe Tax instead. Talk to your accountant either way.
- **The product's tax category is "SaaS: electronic download, business use"** (`txcd_10103101`). That's the closest match for a subscription with a downloaded app sold to organisations. The other candidate is "Downloadable software: business use" (`txcd_10202003`). This is a tax classification decision, so confirm it with your accountant; it can be changed on the product at any time.

---

## 1. Register EntraPlus in Microsoft Entra

Use the **same** app registration as the desktop app, so customers only ever approve "EntraPlus" once.

1. Go to entra.microsoft.com > **App registrations** > **New registration** (or open the existing EntraPlus one).
   - **Name:** EntraPlus
   - **Supported account types:** *Accounts in any organizational directory (multitenant)*
2. Open **Authentication** > **Add a platform** > **Web**. The redirect URI is
   `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
   (Supabase shows the exact URL on its Azure provider page.) The desktop app's "Mobile and desktop" platform stays as it is.
3. Open **Certificates & secrets** > **New client secret**. Copy the **Value**, not the Secret ID. Note the expiry date in your calendar, because sign-in breaks when it expires. EntraPlus's own Applications page will show it in amber as it gets close.
4. Open **Token configuration** > **Add optional claim** > **ID**. Tick `email` and `xms_edov`, and accept the prompt to add the Graph `email` permission. Supabase needs Microsoft to send a verified email address, and `xms_edov` is how Microsoft says the email domain has been verified.
5. Open **API permissions**. You need `openid`, `profile`, `email` and `User.Read`, all delegated.
6. Recommended: complete **Branding & properties** > **Publisher verification** with your Microsoft Partner (MPN) ID. Schools see "EntraPlus, verified" instead of "unverified", and many tenants only allow users to approve verified apps.

**Schools that block users approving apps.** Many school tenants only let admins approve apps. Their IT admin approves once for everyone by opening this link and signing in as an admin:
`https://login.microsoftonline.com/organizations/adminconsent?client_id=YOUR-CLIENT-ID`
It's worth putting that link in your onboarding email or FAQ.

## 2. Supabase project

1. Create a project at supabase.com and choose a London region.
2. **Authentication > Sign In / Providers > Azure:** switch it on.
   - Paste the **client ID** and **secret value** from step 1.
   - Set **Azure Tenant URL** to `https://login.microsoftonline.com/organizations`. This lets in any work or school account and keeps personal Microsoft accounts out.
3. In the same section, switch **off** the Email provider, so nobody can create a password account.
4. **Authentication > URL Configuration:**
   - **Site URL:** `https://entraplus.co.uk`
   - **Redirect URLs:** `https://entraplus.co.uk/account.html` and, for testing on your PC, `http://localhost:8000/account.html`
5. **SQL Editor:** paste in `supabase/schema.sql` and run it.
6. **Project Settings > API:** copy the project URL and the publishable (anon) key into `assets/js/config.js`:
   ```js
   auth: { mode: "supabase", supabaseUrl: "https://YOUR-PROJECT.supabase.co", supabaseAnonKey: "sb_publishable_..." }
   ```
   This key is designed to be public. The database rules stop anyone seeing another organisation, and stop technicians seeing billing.

**One-minute check after your first sign-in.** The database works out each person's organisation from their Microsoft tenant ID, which Supabase stores from Microsoft's verified sign-in. Sign in once, then run this in the SQL Editor:

```sql
select email, raw_user_meta_data -> 'custom_claims' ->> 'tid' as tid_1, raw_user_meta_data ->> 'iss' as iss
from auth.users order by created_at desc limit 1;
```

One of those columns should contain your tenant ID (Entra admin centre > Overview > Tenant ID). The schema checks both, plus the same fields in `auth.identities`. If neither has it, tell me what the row contains and I'll adjust `my_tenant()`.

## 3. Server functions

You need the Supabase CLI (`npm i -g supabase`, or see supabase.com/docs/guides/cli). From this `backend` folder:

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF

supabase secrets set STRIPE_SECRET_KEY=sk_test_...          # Stripe > Developers > API keys (sandbox)
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...        # from step 4
supabase secrets set SITE_ORIGIN=https://entraplus.co.uk
supabase secrets set LICENCE_PRIVATE_KEY_PEM="$(cat ../../EntraPlus/tools/keys/private_key.pem)"

supabase functions deploy stripe-webhook --no-verify-jwt   # Stripe calls this, so it checks Stripe's signature instead
supabase functions deploy member-licence                   # only signed-in people can call this
```

`LICENCE_PRIVATE_KEY_PEM` must be the private half of the key pair built into the app (`python tools/licence_tool.py keygen` in the EntraPlus project). It lives only here and in your offline backup.

## 4. Stripe webhook

Stripe > Developers > **Webhooks** > Add endpoint (in the sandbox):

- **URL:** `https://YOUR-PROJECT.supabase.co/functions/v1/stripe-webhook`
- **Events:**
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`

Copy the signing secret (`whsec_...`) into step 3 and redeploy the webhook. I can create this endpoint through the Stripe connector once you know your Supabase project address.

How purchases find the right organisation: the account page adds the organisation's ID to the payment link (`client_reference_id`). The webhook saves it on the subscription, so every later event (renewals, seat changes in the portal, cancellations) finds the organisation too.

## 5. Publish the website

Commit and push the site as usual. `config.js` now has the Stripe test links and your Supabase details.

## 6. What people see

- **Not signed in:** "Sign in with Microsoft" (or "Continue with Microsoft" on the register page).
- **First from their organisation:** they name the organisation and become its manager.
- **Colleague:** "Waiting for approval: ask *Jack Taylor* to approve you."
- **Technician or senior technician:** their role, whether they have a seat, and their licence key with Reveal and Copy. There's no billing information at all.
- **Manager**, in addition:
  - **Subscription:** plan, seats, price per seat, total, and the renewal or end date. Buy buttons if there's no plan yet, otherwise "Change seats or plan", which opens Stripe.
  - **People:** approve or decline, role, a Pro seat switch, and remove. The seat limit and the always-one-manager rule are enforced by the database, not just the page.
  - **Purchase history:** date, invoice number with link and PDF, seats, amount and status.

When a manager reduces seats in Stripe, seats are taken back automatically. Managers keep theirs first, then the longest-standing technicians. When a subscription starts, the manager gets a seat automatically.

## 7. Test it end to end (sandbox)

1. Sign in with your work account and set up your organisation.
2. Ask a colleague to sign in, or use a second account in your tenant. They show as waiting in your People list.
3. Click **Yearly**, choose 2 seats, and pay with the test card `4242 4242 4242 4242` (any future date, any CVC).
4. Back on the account page, the subscription shows "yearly for 2 technicians" and you have a seat. Reveal your key and paste it into the app (Settings > Enter a licence key).
5. Approve your colleague, make them a senior technician and give them the second seat. A third seat should be refused.
6. **Change seats or plan:** reduce to 1 seat in Stripe's portal. Your colleague loses their seat and you keep yours.
7. Check Purchase history shows the invoice.

If something doesn't update:
- **Stripe > Webhooks** shows every delivery and the function's reply.
- **Supabase > Edge Functions > Logs** shows any errors.

## 8. Going live

1. Finish activating your Stripe account (business details, bank account).
2. Recreate the product, both prices, both payment links and the portal in **live mode**. I can do this through the Stripe connector once a live account is connected, using the same settings as the sandbox.
3. Add a live webhook endpoint, then set the live `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` secrets.
4. Put the live links in `config.js`.

## Next: the desktop app

The app's sidebar Sign in button already opens the website. The next step is a third function, `app-licence`:

1. The app opens the browser and the person signs in with Microsoft as above.
2. The browser hands the app a one-time code, which the app swaps for a licence key.
3. The app refreshes the key quietly every day.

Licence keys already include the person's `role` and an `advanced` flag, so the app can then allow advanced mode only for managers and senior technicians, set centrally rather than per PC.
