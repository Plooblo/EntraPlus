// Signs EntraPlus licence keys in exactly the format the desktop app checks
// (entraplus/licensing/licence.py): base64url(JSON payload) + "." + base64url(Ed25519 signature).
// The app ignores fields it doesn't know, so "org", "role" and "advanced" are safe to include
// and ready for the app to use later (e.g. to allow advanced mode only for senior technicians).

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// The signing key comes from either secret:
//   LICENCE_PRIVATE_KEY      one line of hex (preferred: paste it into Supabase > Edge Functions > Secrets)
//                            printed by  python tools/licence_tool.py server-secret
//   LICENCE_PRIVATE_KEY_PEM  the PEM file's contents (older setup)
const PKCS8_ED25519_PREFIX = "302e020100300506032b657004220420";

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

function privateKeyDer(): Uint8Array<ArrayBuffer> {
  const hex = (Deno.env.get("LICENCE_PRIVATE_KEY") ?? "").trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(hex)) return hexToBytes(PKCS8_ED25519_PREFIX + hex);
  const pem = Deno.env.get("LICENCE_PRIVATE_KEY_PEM") ?? "";
  if (!pem.includes("PRIVATE KEY")) throw new Error("No licence signing key: set the LICENCE_PRIVATE_KEY secret.");
  return Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
}

let keyPromise: Promise<CryptoKey> | null = null;
function signingKey(): Promise<CryptoKey> {
  if (!keyPromise) keyPromise = crypto.subtle.importKey("pkcs8", privateKeyDer(), { name: "Ed25519" }, true, ["sign"]);
  return keyPromise;
}

/** The public half of the signing key, as hex. Not secret: it lets the setup checker confirm the app matches. */
export async function publicKeyHex(): Promise<string> {
  const jwk = await crypto.subtle.exportKey("jwk", await signingKey());
  const raw = Uint8Array.from(atob(jwk.x!.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  return Array.from(raw).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface LicenceFields {
  licenceId: string;
  email: string;
  period: string;
  expires: string;        // YYYY-MM-DD
  org?: string;
  role?: string;
}

export async function makeLicenceKey(f: LicenceFields): Promise<string> {
  const payload = {
    product: "entraplus",
    licence_id: f.licenceId,
    email: f.email,
    plan: "pro",
    period: f.period,
    issued: new Date().toISOString().slice(0, 10),
    expires: f.expires,
    org: f.org ?? "",
    role: f.role ?? "technician",
    advanced: f.role === "manager" || f.role === "senior",
  };
  const payloadB64 = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", await signingKey(), enc.encode(payloadB64)));
  return `${payloadB64}.${b64url(sig)}`;
}

export const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_ORIGIN") ?? "https://entraplus.co.uk",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
