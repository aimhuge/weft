import { createPrivateKey, sign } from "node:crypto";
import type { InviteAnswer } from "./testflight-types";

// TestFlight invites for the Weft phone app (docs/architecture/mobile.md#testflight), on weft.zip's side: the App Store
// Connect API adds a tester to the external beta group by email and Apple sends them the invite. The key is an App
// Store Connect API key with the App Manager or Admin role (the notarization key may be a Developer one, which can't),
// kept in the deployment's env and never on a Mac.

const API = "https://api.appstoreconnect.apple.com";

// The deployment's env, or a plain map in tests (Next's ProcessEnv type insists on NODE_ENV).
type Env = Record<string, string | undefined>;

export interface TestflightConfig {
  issuerId: string;
  keyId: string;
  // The .p8 file's PEM, with real newlines or "\n" escapes (how a one-line env var carries it).
  privateKey: string;
  groupId: string;
}

// The group's public link, which the QR code carries. Only a TestFlight link counts, so a typo can't send a camera elsewhere.
export function testflightPublicUrl(env: Env = process.env): string | null {
  const url = env.TESTFLIGHT_PUBLIC_URL?.trim();
  return url && /^https:\/\/testflight\.apple\.com\/join\/[A-Za-z0-9]+$/.test(url) ? url : null;
}

// null until every value is set, so the route answers 503 and the desktop offers the QR code alone.
export function testflightConfig(env: Env = process.env): TestflightConfig | null {
  const issuerId = env.ASC_ISSUER_ID?.trim();
  const keyId = env.ASC_KEY_ID?.trim();
  const privateKey = env.ASC_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  const groupId = env.TESTFLIGHT_GROUP_ID?.trim();
  return issuerId && keyId && privateKey && groupId ? { issuerId, keyId, privateKey, groupId } : null;
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

// The ES256 token App Store Connect wants: 20 minutes is its longest, we ask for 10.
export function ascToken(cfg: TestflightConfig, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const head = b64url(JSON.stringify({ alg: "ES256", kid: cfg.keyId, typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: cfg.issuerId, iat, exp: iat + 600, aud: "appstoreconnect-v1" }));
  const key = createPrivateKey(cfg.privateKey);
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64url(sig)}`;
}


// "Jane Q Doe" → Jane / Q Doe: Apple shows these in App Store Connect's tester list, nothing more.
export function splitName(name: string | null | undefined): { firstName?: string; lastName?: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return {};
  return parts.length === 1 ? { firstName: parts[0] } : { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

async function appleError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { errors?: { detail?: string; title?: string }[] };
  const first = body.errors?.[0];
  return first?.detail || first?.title || `App Store Connect answered ${res.status}.`;
}

// Adds the person to the group, which sends Apple's invite email. Someone already in the account (another group, an
// earlier invite) answers 409 on create, so they're found by email and added to the group instead; already in the
// group is a success too, since a second ask is just a person who lost the email.
export async function inviteTester(
  cfg: TestflightConfig,
  person: { email: string; name?: string | null },
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<InviteAnswer> {
  const headers = { authorization: `Bearer ${ascToken(cfg, now)}`, "content-type": "application/json" };
  const group = { type: "betaGroups", id: cfg.groupId };
  const attributes = { email: person.email, ...splitName(person.name) };
  const created = await fetchImpl(`${API}/v1/betaTesters`, {
    method: "POST",
    headers,
    body: JSON.stringify({ data: { type: "betaTesters", attributes, relationships: { betaGroups: { data: [group] } } } }),
  });
  if (created.ok) return { ok: true, email: person.email, already: false };
  if (created.status !== 409) return { ok: false, error: await appleError(created) };

  const found = await fetchImpl(`${API}/v1/betaTesters?filter[email]=${encodeURIComponent(person.email)}&limit=1`, { headers });
  if (!found.ok) return { ok: false, error: await appleError(found) };
  const id = ((await found.json()) as { data?: { id: string }[] }).data?.[0]?.id;
  if (!id) return { ok: false, error: "App Store Connect says this email is taken but can't find the tester." };
  const added = await fetchImpl(`${API}/v1/betaGroups/${cfg.groupId}/relationships/betaTesters`, {
    method: "POST",
    headers,
    body: JSON.stringify({ data: [{ type: "betaTesters", id }] }),
  });
  if (!added.ok && added.status !== 409) return { ok: false, error: await appleError(added) };
  return { ok: true, email: person.email, already: true };
}
