// The provider signature registries the webhook relay uses (lib/webhook-relay.ts). Each provider
// says where its signing secret lives in the request and how to verify it. GitHub and Vercel are
// already known to the deployed Weft (lib/github-relay.ts, lib/vercel-relay.ts); Stripe, Resend and
// Svix-shaped providers follow the same HMAC pattern.
//
// These four are the whole set: a relay names one of them, and a delivery without a known
// provider's signature is refused (lib/webhook-relay.ts). There is no generic provider and no
// shared-header opt-out — an allowlist that could be widened by an env var is an allowlist that
// eventually is.
//
// Verifiers run over the raw request bytes (the body the provider signed), use constant-time
// compares, and ignore the request's body parsing — the same byte-exactness that lets the local
// route verify the signature after forwarding. Replay windows use the provider's own timestamp so
// rejecting a stale delivery is the same for the local route and the deployed relay.

import { timingSafeEqual } from "node:crypto";
import { hmacHex, hmacSha256Hex } from "./webhook-signatures-hmac";

export type Headers = Record<string, string>;

export interface SignatureProvider {
  // The shape of the signature header value (lowercased). The verifier picks the matching header.
  signatureHeader: string;
  // Returns true when the body's HMAC over the secret matches the header. Throws nothing: a bad
  // header format returns false; only the body's bytes are signed.
  verify(secret: string, body: string, headers: Headers, now: number): boolean;
}

// 5 minutes is what the other Weft relays use for Svix/Resend; Stripe's own tolerance defaults to
// 300s too, so the relay and the local target agree on what counts as fresh.
const REPLAY_MS = 5 * 60 * 1000;

export const PROVIDERS = new Map<string, SignatureProvider>([
  [
    "stripe",
    {
      // Stripe-Signature: t=1700000000,v1=ab12cd... (multiple v1= entries allowed).
      signatureHeader: "stripe-signature",
      verify(secret, body, headers) {
        const header = headers["stripe-signature"] ?? "";
        if (!header) return false;
        let t = "";
        let v1 = "";
        for (const part of header.split(",")) {
          const [k, v] = part.split("=", 2);
          if (!k || !v) continue;
          if (k.trim() === "t") t = v;
          else if (k.trim() === "v1") v1 = v;
        }
        if (!t || !v1) return false;
        const expected = hmacHex(secret, `${t}.${body}`);
        return sameHex(v1, expected);
      },
    },
  ],
  [
    "github",
    {
      signatureHeader: "x-hub-signature-256",
      verify(secret, body, headers) {
        const header = headers["x-hub-signature-256"] ?? "";
        if (!header.startsWith("sha256=")) return false;
        const expected = hmacSha256Hex(secret, body);
        return sameHex(header.slice(7), expected);
      },
    },
  ],
  [
    "vercel",
    {
      // Vercel signs the body with the hook's secret; x-vercel-signature is the lowercase hex result.
      signatureHeader: "x-vercel-signature",
      verify(secret, body, headers) {
        const header = headers["x-vercel-signature"] ?? "";
        if (!header) return false;
        // Vercel uses HMAC-SHA1. The shared helper offers both, so the relay and lib/vercel-relay.ts
        // stay byte-compatible.
        const expected = hmacHex(secret, body, "sha1");
        return sameHex(header, expected);
      },
    },
  ],
  [
    // Svix headers carry id.timestamp.body, signed with the webhook's secret using HMAC-SHA256. Resend
    // and most Svix-shaped providers (Clerk, Knock) use the same wire format.
    "svix",
    {
      signatureHeader: "svix-signature",
      verify(secret, body, headers, now) {
        const header = headers["svix-signature"] ?? "";
        const id = headers["svix-id"] ?? "";
        const ts = Number(headers["svix-timestamp"] ?? "");
        if (!header || !id || !Number.isFinite(ts)) return false;
        // 5-minute replay window: any later delivery is accepted, anything older or further than 5 min
        // in the future is dropped. The clock comes in so tests pin it.
        const skew = Math.abs(now - ts * 1000);
        if (skew > REPLAY_MS) return false;
        const expected = hmacSha256Hex(secret, `${id}.${ts}.${body}`);
        // Same prefix shape Stripe uses: "v1,<hex>".
        const matched = header.split(" ").some((part) => sameHex(part.split(",")[1] ?? "", expected));
        return matched;
      },
    },
  ],
]);

// Compares two hex strings in constant time by length and pair of characters; mismatched lengths
// short-circuit to false without revealing where a forged signature starts to diverge.
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    // One of the inputs isn't hex (an attacker passed e.g. "z"; Buffer.from("z","hex") yields "").
    return false;
  }
}

// The relay calls this for every provider: empty default; only registers with a populated provider.
export function isKnownProvider(name: string): boolean {
  return PROVIDERS.has(name);
}
