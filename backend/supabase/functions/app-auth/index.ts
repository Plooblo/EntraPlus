// Signs the EntraPlus desktop app in with the person's website (Microsoft) account.
//
// How it works (OAuth-style, with PKCE so an intercepted code is useless):
//   1. The app starts a tiny local web server on 127.0.0.1, makes a random secret (the "verifier") and
//      opens  https://entraplus.co.uk/app-signin.html?port=…&state=…&challenge=SHA256(verifier).
//   2. The person signs in with Microsoft on the website (or is already signed in) and presses Continue.
//      The page calls  action "code"  with their Supabase session; we return a one-time code bound to the
//      challenge, and the page sends the browser to  http://127.0.0.1:<port>/callback?code=…&state=…
//   3. The app calls  action "token"  with the code and its verifier. If SHA256(verifier) matches, it gets
//      a long-lived app session token (we only keep its hash), the person's profile and their licence key.
//   4. The app calls  action "refresh"  daily for a fresh profile and key, and  "signout"  to end the session.
//
// Deploy:  supabase functions deploy app-auth --no-verify-jwt
// (The app has no Supabase session, so the gateway check is off; "code" checks the website session itself.)

import { createClient } from "npm:@supabase/supabase-js@2";
import { b64url, cors, json, publicKeyHex } from "../_shared/licence.ts";
import { standing } from "../_shared/members.ts";

const CODE_MINUTES = 5;
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const B64URL = /^[A-Za-z0-9_-]+$/;

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
async function hashHex(text: string): Promise<string> {
  return Array.from(await sha256(text)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}
function clean(text: unknown, max: number): string {
  return String(text ?? "").replace(/[^\w .()'-]/g, "").slice(0, max);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }

  switch (body.action) {
    // ---- setup check: the public half of the signing key (safe to share)
    case "public-key": {
      try {
        return json({ public_key: await publicKeyHex() });
      } catch (err) {
        return json({ error: (err as Error).message }, 500);
      }
    }

    // ---- 2. the website asks for a one-time code for the signed-in person
    case "code": {
      const challenge = String(body.challenge ?? "");
      if (challenge.length < 43 || challenge.length > 128 || !B64URL.test(challenge)) {
        return json({ error: "This sign-in link didn't come from the EntraPlus app." }, 400);
      }
      const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: auth } = await db.auth.getUser(jwt);
      if (!auth?.user) return json({ error: "Please sign in again." }, 401);
      const code = randomToken();
      const { error } = await db.from("app_codes").insert({
        code_hash: await hashHex(code), user_id: auth.user.id, challenge,
        expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(),
      });
      if (error) return json({ error: "Couldn't start the app sign-in. Please try again." }, 500);
      return json({ code });
    }

    // ---- 3. the app swaps the code (plus its verifier) for a session
    case "token": {
      const code = String(body.code ?? ""), verifier = String(body.verifier ?? "");
      if (!code || verifier.length < 43 || !B64URL.test(verifier)) return json({ error: "Bad request." }, 400);
      const { data: row } = await db.from("app_codes").select("*").eq("code_hash", await hashHex(code)).maybeSingle();
      if (!row || row.used || new Date(row.expires_at) < new Date()) {
        return json({ error: "That sign-in has expired. Please sign in again from the app." }, 400);
      }
      // Single use, even if the verifier turns out to be wrong.
      await db.from("app_codes").update({ used: true }).eq("code_hash", row.code_hash);
      if (b64url(await sha256(verifier)) !== row.challenge) return json({ error: "Sign-in check failed." }, 400);
      const token = randomToken(48);
      const { error } = await db.from("app_sessions").insert({
        token_hash: await hashHex(token), user_id: row.user_id, device: clean(body.device, 80),
      });
      if (error) return json({ error: "Couldn't finish signing in. Please try again." }, 500);
      await db.rpc("prune_app_auth");
      return json({ refresh_token: token, ...(await standing(db, row.user_id)) });
    }

    // ---- 4. daily refresh, and sign out
    case "refresh":
    case "signout": {
      const token = String(body.refresh_token ?? "");
      if (!token) return json({ error: "Bad request." }, 400);
      const { data: s } = await db.from("app_sessions").select("id, user_id, revoked, last_seen")
        .eq("token_hash", await hashHex(token)).maybeSingle();
      if (body.action === "signout") {
        if (s) await db.from("app_sessions").update({ revoked: true }).eq("id", s.id);
        return json({ ok: true });
      }
      const idle = s ? (Date.now() - new Date(s.last_seen).getTime()) / 86_400_000 : 0;
      if (!s || s.revoked || idle > 90) {
        return json({ error: "You've been signed out of EntraPlus on this PC. Please sign in again." }, 401);
      }
      await db.from("app_sessions").update({ last_seen: new Date().toISOString() }).eq("id", s.id);
      return json(await standing(db, s.user_id));
    }
  }
  return json({ error: "Unknown action." }, 400);
});
