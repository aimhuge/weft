// Pairing a phone or a browser with this Mac (docs/architecture/mobile-security.md, "Pairing"): the link the QR code
// holds, and the claim the device writes back. The secret rides in the link's fragment, which a browser never sends,
// so the server never sees it; the claim's proof (an HMAC with that secret) shows the claimer saw the code, and its
// signature shows it holds the signing key it names. The phone app copies parsePairingLink and makeClaim.
import { b64, unb64, type Sodium } from "./sodium";

export const PAIR_URL = "https://weft.zip/pair";
// How long a code stays open (the row's expires_at says the same).
export const PAIRING_TTL_MS = 5 * 60_000;

export interface PairingLink {
  id: string;
  // 32 random bytes, base64url.
  secret: string;
  orgId: string;
  // The Mac's device-key fingerprint, so the phone can show which Mac it's pairing with.
  mac: string;
}

export type ClaimKind = "phone" | "browser";
export type ClaimPlatform = "ios" | "android" | "web" | "darwin";

export interface Claim {
  name: string;
  platform: ClaimPlatform;
  kind: ClaimKind;
  // X25519 public key (base64): the workspace key is sealed to it.
  box_key: string;
  // Ed25519 public key (base64): approvals are signed with it. A browser has one too but can't approve.
  sign_key: string;
  proof: string;
  sig: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function pairingLink(link: PairingLink): string {
  const hash = new URLSearchParams({ v: "1", p: link.id, s: link.secret, o: link.orgId, m: link.mac });
  return `${PAIR_URL}#${hash.toString()}`;
}

export function parsePairingLink(url: string): PairingLink | null {
  const at = url.indexOf("#");
  if (at < 0) return null;
  const q = new URLSearchParams(url.slice(at + 1));
  const id = q.get("p") ?? "";
  const orgId = q.get("o") ?? "";
  const secret = q.get("s") ?? "";
  if (q.get("v") !== "1" || !UUID.test(id) || !UUID.test(orgId) || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  return { id, secret, orgId, mac: q.get("m") ?? "" };
}

export const newPairingSecret = (s: Sodium) => s.to_base64(s.randombytes_buf(32), s.base64_variants.URLSAFE_NO_PADDING);

type ClaimBody = Omit<Claim, "proof" | "sig">;

export const claimMessage = (pairingId: string, orgId: string, c: ClaimBody) =>
  ["weft-pair-v1", pairingId, orgId, c.box_key, c.sign_key, c.name, c.platform, c.kind].join("\n");

const secretKey = (s: Sodium, secret: string) => s.from_base64(secret, s.base64_variants.URLSAFE_NO_PADDING);

// The device's half: the claim with its proof and signature.
export function makeClaim(s: Sodium, link: PairingLink, body: ClaimBody, signPrivateKey: string): Claim {
  const message = s.from_string(claimMessage(link.id, link.orgId, body));
  return { ...body, proof: b64(s, s.crypto_auth(message, secretKey(s, link.secret))), sig: b64(s, s.crypto_sign_detached(message, unb64(s, signPrivateKey))) };
}

const KINDS: readonly string[] = ["phone", "browser"];
const PLATFORMS: readonly string[] = ["ios", "android", "web", "darwin"];

// The Mac's half: why the claim in the row can't be trusted, or null when it can.
export function checkClaim(s: Sodium, link: Pick<PairingLink, "id" | "orgId" | "secret">, claim: Partial<Claim>): string | null {
  const { name, platform, kind, box_key, sign_key, proof, sig } = claim;
  if (!name || !platform || !kind || !box_key || !sign_key || !proof || !sig) return "The claim is missing a field.";
  if (!KINDS.includes(kind) || !PLATFORMS.includes(platform)) return "The claim names an unknown kind of device.";
  const message = s.from_string(claimMessage(link.id, link.orgId, { name, platform, kind, box_key, sign_key }));
  try {
    if (!s.crypto_auth_verify(unb64(s, proof), message, secretKey(s, link.secret))) return "The claim wasn't made with this code.";
    if (!s.crypto_sign_verify_detached(unb64(s, sig), message, unb64(s, sign_key))) return "The claim's signature doesn't match its key.";
  } catch {
    return "The claim isn't readable.";
  }
  return null;
}
