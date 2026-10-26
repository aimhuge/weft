import crypto from "node:crypto";

// PKCE for the Slack install (lib/slack-oauth.ts): the app is a public client, so the code exchange proves
// itself with a verifier instead of the Client Secret.
//
// The flow: /install makes a random verifier, keeps its hash in the `state` it sends to Slack, and the
// callback sends the verifier back as `code_verifier`. Slack checks the hash and hands over the tokens.
// The secret never leaves the console page — which is the whole point of turning PKCE on.
//
// The verifier is short-lived and single-use, so it lives in the state itself rather than in a store: the
// state is signed with the app's own key so a tampered one can't make the callback send someone else's
// verifier.

const VERIFIER_BYTES = 32;
const STATE_TTL_MS = 15 * 60_000;

// The verifier Slack expects: 43-128 characters of unreserved URL characters.
export function makeVerifier(): string {
  return crypto.randomBytes(VERIFIER_BYTES).toString("base64url");
}

// The challenge for the verifier: base64url(SHA-256(verifier)), which is what `S256` means.
export function challengeOf(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

// The state is the verifier's hash plus the verifier itself, signed, so the callback can check it has not
// been edited and can still find the verifier. It is one round trip, so it never needs to be stored.
export interface PkceState {
  verifier: string;
  challenge: string;
  /** The state as it goes out to Slack and comes back. */
  value: string;
  /** False when the state was signed by someone else, or has expired. */
  ok: boolean;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

/** Builds the state for an install: a verifier, its challenge, and the signed pair that travels. */
export function makeState(secret: string, now: number = Date.now()): PkceState {
  const verifier = makeVerifier();
  const challenge = challengeOf(verifier);
  const payload = `${challenge}.${verifier}.${now}`;
  return { verifier, challenge, value: `${payload}.${sign(payload, secret)}`, ok: true };
}

/** Reads a state back: the verifier it carries, and whether it is ours and still fresh. */
export function readState(value: string | null | undefined, secret: string, now: number = Date.now()): PkceState {
  // The state is normalised once: past here it is a string, so the answers can carry it as it came.
  const state = value ?? "";
  const parts = state.split(".");
  if (parts.length !== 4) return { verifier: "", challenge: "", value: state, ok: false };
  const [challenge, verifier, at, mac] = parts as [string, string, string, string];
  const payload = `${challenge}.${verifier}.${at}`;
  if (!timingSafeEqual(sign(payload, secret), mac)) return { verifier: "", challenge: "", value: state, ok: false };
  const age = now - Number(at);
  if (!Number.isFinite(age) || age < 0 || age > STATE_TTL_MS) {
    return { verifier: "", challenge: "", value: state, ok: false };
  }
  return { verifier, challenge, value: state, ok: true };
}

// The signing key: the app's Client Secret when there is one, else the server's own secret. Either way the
// key never leaves the process.
export function stateSecret(env: Record<string, string | undefined> = process.env): string {
  return env.SLACK_CLIENT_SECRET?.trim() || env.SLACK_STATE_SECRET?.trim() || env.SESSION_SECRET?.trim() || "weft-slack-pkce";
}

function sign(payload: string, secret: string): string {
  return b64url(crypto.createHmac("sha256", secret).update(payload).digest());
}

// Two signatures of the same length, compared without leaking where they differ.
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
