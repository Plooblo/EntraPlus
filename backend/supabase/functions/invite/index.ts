// A manager invites colleagues to their organisation.
//
// Each address must be at one of the organisation's own email domains (the domains its members signed in with
// through Microsoft). Joining still needs a Microsoft sign-in from the organisation's tenant, so an invite can never
// let an outsider in: it just skips "waiting for approval" and sets their role.
//
// Emails are sent with Resend (resend.com) if RESEND_API_KEY is set; otherwise the manager gets a link to send.
// Deploy:  supabase functions deploy invite        (JWT verification stays ON)
// Secrets: RESEND_API_KEY (optional), INVITE_FROM (optional, e.g. "EntraPlus <invites@entraplus.co.uk>"), SITE_ORIGIN

import { createClient } from "npm:@supabase/supabase-js@2";
import { cors, json } from "../_shared/licence.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const SITE = Deno.env.get("SITE_ORIGIN") ?? "https://entraplus.co.uk";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = Deno.env.get("INVITE_FROM") ?? "EntraPlus <invites@entraplus.co.uk>";
const ROLES: Record<string, string> = { manager: "manager", senior: "senior technician", technician: "technician" };
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function inviteLink(org: string, email: string): string {
  return `${SITE}/register.html?invite=1&org=${encodeURIComponent(org)}&email=${encodeURIComponent(email)}`;
}

async function sendEmail(to: string, from: string, org: string, role: string, link: string): Promise<boolean> {
  if (!RESEND_KEY) return false;
  const text = `${from} has invited you to join ${org} on EntraPlus as a ${ROLES[role]}.\n\n` +
    `EntraPlus is the Windows app your IT team uses for Microsoft 365, Intune and Active Directory.\n\n` +
    `Accept: ${link}\n\nSign in with your ${to.split("@")[1]} Microsoft account. The invite lasts 30 days.\n`;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;color:#1b2733">
    <h1 style="font-size:20px">You're invited to EntraPlus</h1>
    <p><strong>${escapeHtml(from)}</strong> has invited you to join <strong>${escapeHtml(org)}</strong> on EntraPlus as a ${ROLES[role]}.</p>
    <p>EntraPlus is the Windows app your IT team uses for Microsoft 365, Intune and Active Directory.</p>
    <p style="margin:28px 0"><a href="${link}" style="background:#0f8a82;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Accept the invite</a></p>
    <p style="color:#5b6b7a;font-size:14px">Sign in with your ${escapeHtml(to.split("@")[1])} Microsoft account. The invite lasts 30 days.
      If you weren't expecting this, you can ignore it.</p></div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject: `${from} invited you to ${org} on EntraPlus`, text, html }),
  });
  if (!r.ok) console.error("Resend refused the email", r.status, await r.text());
  return r.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await db.auth.getUser(jwt);
  if (!auth?.user) return json({ error: "Please sign in again." }, 401);

  const { data: me } = await db.from("members").select("org_id, role, status, name, email")
    .eq("user_id", auth.user.id).neq("status", "removed").maybeSingle();
  if (!me || me.status !== "active" || me.role !== "manager") return json({ error: "Only managers can invite people." }, 403);
  const { data: org } = await db.from("organisations").select("name").eq("id", me.org_id).maybeSingle();
  const { data: domains } = await db.rpc("org_domains", { o: me.org_id });
  const allowed: string[] = (domains as string[] | null) ?? [];
  const inviter = me.name || me.email;

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* empty */ }

  // Resend one invite
  if (body.resend) {
    const { data: inv } = await db.from("invites").select("*").eq("id", body.resend).eq("org_id", me.org_id).maybeSingle();
    if (!inv || inv.accepted_at) return json({ error: "That invite has already been used or cancelled." }, 400);
    const link = inviteLink(org!.name, inv.email);
    const sent = await sendEmail(inv.email, inviter, org!.name, inv.role, link);
    await db.from("invites").update({ emailed: inv.emailed || sent, expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() }).eq("id", inv.id);
    return json({ results: [{ email: inv.email, status: sent ? "sent" : "link", link }] });
  }

  const role = ROLES[body.role] ? body.role : "technician";
  const emails: string[] = Array.from(new Set(String(body.emails ?? "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))).slice(0, 50);
  if (!emails.length) return json({ error: "Enter at least one email address." }, 400);

  const results = [];
  for (const email of emails) {
    const domain = email.split("@")[1] ?? "";
    if (!EMAIL.test(email)) { results.push({ email, status: "invalid" }); continue; }
    if (!allowed.includes(domain)) { results.push({ email, status: "wrong_domain" }); continue; }
    const { data: existing } = await db.from("members").select("user_id, status").eq("org_id", me.org_id).ilike("email", email).maybeSingle();
    if (existing?.status === "active") { results.push({ email, status: "already_member" }); continue; }
    if (existing?.status === "pending") {                     // already signed in and waiting: inviting them approves them
      await db.from("members").update({ status: "active", role }).eq("org_id", me.org_id).eq("user_id", existing.user_id);
      results.push({ email, status: "approved" });
      continue;
    }
    await db.from("invites").delete().eq("org_id", me.org_id).ilike("email", email).is("accepted_at", null);
    const { data: inv, error } = await db.from("invites").insert({ org_id: me.org_id, email, role, invited_by: auth.user.id }).select().single();
    if (error) { results.push({ email, status: "error", error: error.message }); continue; }
    const link = inviteLink(org!.name, email);
    const sent = await sendEmail(email, inviter, org!.name, role, link);
    if (sent) await db.from("invites").update({ emailed: true }).eq("id", inv.id);
    results.push({ email, status: sent ? "sent" : "link", link });
  }
  return json({ results, domains: allowed, email_service: !!RESEND_KEY });
});
