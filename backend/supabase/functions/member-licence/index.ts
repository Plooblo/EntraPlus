// The account page's "Reveal licence key": a signed-in person with a Pro seat gets their key.
// Deploy:  supabase functions deploy member-licence      (JWT verification stays ON)
import { createClient } from "npm:@supabase/supabase-js@2";
import { cors, json } from "../_shared/licence.ts";
import { standing } from "../_shared/members.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await db.auth.getUser(jwt);
  if (!auth?.user) return json({ error: "Please sign in again." }, 401);
  const s = await standing(db, auth.user.id);
  if (!s.licence) return json({ error: s.reason }, 403);
  return json({ key: s.licence.key, expires: s.licence.expires, role: s.profile.role });
});
