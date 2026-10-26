// The shapes of the 🪝 webhooks, in a file of types only.
//
// They live here, not in lib/webhooks.ts, because the board draws the webhooks (lib/use-webhooks.ts) and
// lib/client-api.ts names their types — and a client module that names a server module's type still makes
// Turbopack resolve that server module, which reads ~/.weft/webhooks.json with node:fs. A browser chunk
// can't hold node:fs, so the whole board failed to compile. This file imports nothing, so it is safe
// anywhere; lib/webhooks.ts re-exports these names, so the server's own imports keep working.

// One delivery forwarded to target: when, how it went, and how long the local route took.
export interface Delivery {
  at: number;
  method: string;
  // The local route's HTTP status, or 0 when it couldn't be reached.
  status: number;
  ms: number;
  error?: string;
}

export interface Webhook {
  id: string;
  folder: string;
  // What it's for, e.g. "stripe"; one per name in a folder.
  name: string;
  // The local URL a delivery goes to, e.g. http://localhost:3000/api/stripe/webhook.
  target: string;
  // The provider's events it should send, e.g. ["checkout.session.completed"].
  events?: string[];
  // Where the user registers it, e.g. "Stripe dashboard → Developers → Webhooks".
  hint?: string;
  // The vault name of its signing secret, e.g. STRIPE_WEBHOOK_SECRET.
  secret?: string;
  // The provider whose signature the relay verifies (lib/webhook-signatures.ts): `stripe`, `github`,
  // `vercel`, or `svix` (the wire shape Resend and Clerk use). Defaults to the lowercased name when
  // that matches; a "resend" webhook can declare "svix" so the local Weft and the deployed relay agree
  // before the user registers it. Required for a relay URL, since the relay refuses unsigned requests.
  provider?: string;
  // The provider sends to it now; until then it's a blank.
  registered?: boolean;
  // Its public URL on the deployed Weft, and that relay's row id (webhook_relays).
  url?: string;
  relayId?: string;
  // The latest deliveries, newest first, at most MAX_DELIVERIES.
  deliveries?: Delivery[];
  createdAt: number;
  updatedAt: number;
}

export type WebhookInput = Pick<Webhook, "folder" | "name"> & Partial<Pick<Webhook, "target" | "events" | "hint" | "secret" | "provider">>;
export type WebhookPatch = Partial<Pick<Webhook, "name" | "target" | "events" | "hint" | "secret" | "provider" | "registered">>;
