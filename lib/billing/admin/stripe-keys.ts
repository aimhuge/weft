import "server-only";

// Which Stripe account mode an org's billing ids belong to, and a client for each mode (docs/architecture/billing.md
// "Admin console"). Local Weft shares the production Supabase, so a sandbox checkout from a dev run writes test-mode
// `cus_`/`sub_` ids onto a real workspace's row. Stripe ids carry no mode in their prefix, so the admin console holds a
// key per mode and asks Stripe: the mode whose key finds the object is the one it lives in. Every admin call that touches
// Stripe goes through the client for the org's own mode, never the deployment's default key.

import Stripe from "stripe";
import { STRIPE_API_VERSION } from "@aimhuge/billing/server";

export type StripeMode = "live" | "test";
export const STRIPE_MODES: readonly StripeMode[] = ["live", "test"];

// The variables a key may come from. STRIPE_SECRET_KEY is the deployment's own (live on Vercel, the sandbox in local
// development); the two named ones let one console reach both accounts. Each key is filed by its own prefix, so a key
// under the wrong name still lands in its true mode.
export const ADMIN_KEY_VARS = ["STRIPE_LIVE_SECRET_KEY", "STRIPE_TEST_SECRET_KEY", "STRIPE_SECRET_KEY"] as const;

export function keyMode(key: string | undefined): StripeMode | null {
  const match = /^(?:sk|rk)_(live|test)_/.exec((key ?? "").trim());
  return match ? (match[1] as StripeMode) : null;
}

// The first key found for each mode, in ADMIN_KEY_VARS order (the explicitly named ones win).
export function adminStripeKeys(env: Record<string, string | undefined> = process.env): Partial<Record<StripeMode, string>> {
  const keys: Partial<Record<StripeMode, string>> = {};
  for (const name of ADMIN_KEY_VARS) {
    const key = (env[name] ?? "").trim();
    const mode = keyMode(key);
    if (mode && !keys[mode]) keys[mode] = key;
  }
  return keys;
}

export interface AdminStripe {
  // The modes there is a key for.
  modes(): StripeMode[];
  // The client for a mode, or null without a key for it.
  client(mode: StripeMode): Stripe | null;
  // The mode the deployment's own billing (Checkout, the webhook) runs in: STRIPE_SECRET_KEY's.
  defaultMode(): StripeMode | null;
}

export type StripeFactory = (key: string) => Stripe;

const realFactory: StripeFactory = (key) => new Stripe(key, { apiVersion: STRIPE_API_VERSION });

export function adminStripe(env: Record<string, string | undefined> = process.env, factory: StripeFactory = realFactory): AdminStripe {
  const keys = adminStripeKeys(env);
  const clients = new Map<StripeMode, Stripe>();
  return {
    modes: () => STRIPE_MODES.filter((m) => keys[m]),
    client(mode) {
      const key = keys[mode];
      if (!key) return null;
      let client = clients.get(mode);
      if (!client) {
        client = factory(key);
        clients.set(mode, client);
      }
      return client;
    },
    defaultMode: () => keyMode(env.STRIPE_SECRET_KEY),
  };
}

export interface ModeAnswer {
  // live / test: found there. unknown: no key could find it. none: the org has no Stripe ids.
  mode: StripeMode | "unknown" | "none";
  // The customer exists but was deleted in Stripe.
  deleted: boolean;
  // The modes that were asked.
  checked: StripeMode[];
  // Why it's unknown, when it is.
  detail: string | null;
}

// Stripe's wrong-mode error names the other mode: "a similar object exists in test mode, but a live mode key was used".
export function modeFromStripeError(err: unknown): StripeMode | null {
  const message = err instanceof Error ? err.message : "";
  const match = /similar object exists in (live|test) mode/i.exec(message);
  return match ? (match[1] as StripeMode) : null;
}

function isMissing(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "resource_missing" || /no such/i.test(err instanceof Error ? err.message : "");
}

export interface StripeIds {
  customerId: string | null;
  subscriptionId: string | null;
}

async function lookup(client: Stripe, ids: StripeIds): Promise<{ deleted: boolean }> {
  if (ids.customerId) {
    const customer = await client.customers.retrieve(ids.customerId);
    return { deleted: Boolean((customer as { deleted?: boolean }).deleted) };
  }
  await client.subscriptions.retrieve(ids.subscriptionId as string);
  return { deleted: false };
}

// Ask each mode's key for the org's customer (or its subscription, when there is no customer id).
export async function detectMode(stripe: AdminStripe, ids: StripeIds): Promise<ModeAnswer> {
  if (!ids.customerId && !ids.subscriptionId) return { mode: "none", deleted: false, checked: [], detail: null };
  const checked: StripeMode[] = [];
  let hint: StripeMode | null = null;
  let detail: string | null = null;
  for (const mode of stripe.modes()) {
    checked.push(mode);
    try {
      const { deleted } = await lookup(stripe.client(mode) as Stripe, ids);
      return { mode, deleted, checked, detail: null };
    } catch (err) {
      hint = hint ?? modeFromStripeError(err);
      if (!isMissing(err)) detail = err instanceof Error ? err.message : String(err);
    }
  }
  // Stripe's own error can name a mode we hold no key for.
  if (hint) return { mode: hint, deleted: false, checked, detail: `Stripe says these ids are ${hint}-mode; set a ${hint} key to act on them.` };
  return { mode: "unknown", deleted: false, checked, detail: detail ?? (checked.length ? "Neither key found these ids." : "No Stripe key is set.") };
}

export class AdminBillingError extends Error {}

// The client for a mode, or an error that says which key is missing.
export function clientFor(stripe: AdminStripe, mode: ModeAnswer["mode"]): Stripe {
  if (mode !== "live" && mode !== "test") throw new AdminBillingError("This workspace's Stripe mode isn't known, so nothing in Stripe can be changed.");
  const client = stripe.client(mode);
  if (!client) throw new AdminBillingError(`These ids are ${mode}-mode, and no ${mode} Stripe key is set (STRIPE_${mode.toUpperCase()}_SECRET_KEY).`);
  return client;
}
