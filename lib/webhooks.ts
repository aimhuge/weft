import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "./store";
import { isKnownProvider } from "./webhook-signatures";
import type { Delivery, Webhook, WebhookInput, WebhookPatch } from "./webhook-types";

// The 🪝 webhooks of each project (docs/architecture/webhooks.md), kept in ~/.weft/webhooks.json. A webhook is what
// a provider (Stripe, GitHub, Resend…) posts to and the local route that should get it. Until the user (or a thread)
// registers it with the provider it's a blank, counted on the rail like the vault's blanks. A dev server on
// localhost can't be reached from outside, so a webhook can also get a relay URL on the deployed Weft
// (lib/webhook-relay.ts), whose deliveries this Weft hears through Supabase Realtime and forwards to target
// (lib/webhook-forward.ts). Names and URLs only: a webhook's signing secret lives in the 🔐 vault, by name.

// The webhook shapes live in lib/webhook-types.ts (types only, no node:fs), so the board can name them
// without dragging this module into the browser chunk. Re-exported here: the server's own imports of
// "./webhooks" keep working.
export type { Delivery, Webhook, WebhookInput, WebhookPatch };

export const MAX_DELIVERIES = 10;
// A bare path goes to the usual Next dev server.
export const DEFAULT_ORIGIN = "http://localhost:3000";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Read when used, not at import, so a test's WEFT_DATA counts.
const file = () => path.join(DATA_DIR, "webhooks.json");

function read(): Webhook[] {
  try {
    return (JSON.parse(fs.readFileSync(file(), "utf8")) as { hooks?: Webhook[] }).hooks ?? [];
  } catch {
    return [];
  }
}

function write(hooks: Webhook[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ hooks }, null, 2));
  fs.renameSync(tmp, file());
}

export function cleanName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  if (!name) throw new Error("A webhook needs a name, e.g. stripe.");
  return name;
}

// Where deliveries go: a path on the dev server, or a full URL, but only ever on this Mac.
export function cleanTarget(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) throw new Error("A webhook needs the local route it reaches, e.g. /api/stripe/webhook.");
  let url: URL;
  try {
    url = new URL(text.startsWith("/") ? `${DEFAULT_ORIGIN}${text}` : text);
  } catch {
    throw new Error(`${text} isn't a URL or a path.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("A webhook's target is an http URL.");
  if (!LOCAL_HOSTS.has(url.hostname)) throw new Error("A webhook's target is on this Mac (localhost), where the relay forwards it.");
  return url.toString();
}

function cleanEvents(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const list: unknown[] = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const events = [...new Set(list.filter((e): e is string => typeof e === "string").map((e) => e.trim()).filter(Boolean))].slice(0, 50);
  return events.length ? events : undefined;
}

function cleanHint(raw: unknown): string | undefined {
  const hint = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  return hint || undefined;
}

function cleanSecret(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string" || !SECRET_NAME.test(raw)) throw new Error("A webhook's secret is a vault name: letters, digits and _, e.g. STRIPE_WEBHOOK_SECRET.");
  return raw;
}

// The four providers the relay verifies (lib/webhook-signatures.ts). An empty value clears it; unknown
// values are refused so the row the relay ends up with always matches a known verifier.
export function cleanProvider(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") throw new Error("A webhook's provider is one of: stripe, github, vercel, svix.");
  const value = raw.trim().toLowerCase();
  if (!isKnownProvider(value)) throw new Error("A webhook's provider is one of: stripe, github, vercel, svix.");
  return value;
}

// Resolves what the deployed relay verifies against: the recorded value if set, otherwise the
// lowercased name when that matches a known provider ("stripe" → "stripe", "Stripe" → "stripe").
// Returns null when nothing matches — the caller then refuses to mint a relay URL.
export function providerFor(hook: Webhook): string | null {
  if (hook.provider) return hook.provider;
  const lower = hook.name.trim().toLowerCase();
  return isKnownProvider(lower) ? lower : null;
}

// Every webhook, or only those in folders, by folder then name.
export function listWebhooks(folders?: readonly string[]): Webhook[] {
  const keep = folders && new Set(folders);
  return read()
    .filter((h) => !keep || keep.has(h.folder))
    .sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
}

export const getWebhook = (id: string) => read().find((h) => h.id === id);
export const webhookByRelay = (relayId: string) => read().find((h) => h.relayId === relayId);

function requireHook(hooks: Webhook[], id: string): [number, Webhook] {
  const i = hooks.findIndex((h) => h.id === id);
  const hook = hooks[i];
  if (!hook) throw new Error("That webhook is gone.");
  return [i, hook];
}

// Adds a blank, or, when the folder already has one by that name, fills in what's given and keeps the rest
// (like the vault's add_blank keeps a value). existed says which.
export function addWebhook(input: WebhookInput, now = Date.now()): { hook: Webhook; existed: boolean } {
  const folder = typeof input.folder === "string" ? input.folder : "";
  if (!folder) throw new Error("A webhook belongs to a project folder.");
  const name = cleanName(input.name);
  const fields = {
    ...(input.target !== undefined && { target: cleanTarget(input.target) }),
    ...(input.events !== undefined && { events: cleanEvents(input.events) }),
    ...(input.hint !== undefined && { hint: cleanHint(input.hint) }),
    ...(input.secret !== undefined && { secret: cleanSecret(input.secret) }),
    ...(input.provider !== undefined && { provider: cleanProvider(input.provider) }),
  };
  const hooks = read();
  const i = hooks.findIndex((h) => h.folder === folder && h.name.toLowerCase() === name.toLowerCase());
  const found = hooks[i];
  if (found) {
    const hook = { ...found, ...fields, updatedAt: now };
    hooks[i] = hook;
    write(hooks);
    return { hook, existed: true };
  }
  if (!fields.target) throw new Error("A webhook needs the local route it reaches, e.g. /api/stripe/webhook.");
  const hook: Webhook = { id: randomUUID(), folder, name, target: fields.target, ...fields, createdAt: now, updatedAt: now };
  write([...hooks, hook]);
  return { hook, existed: false };
}

export function updateWebhook(id: string, patch: WebhookPatch, now = Date.now()): Webhook {
  const hooks = read();
  const [i, current] = requireHook(hooks, id);
  const next: Webhook = {
    ...current,
    ...(patch.name !== undefined && { name: cleanName(patch.name) }),
    ...(patch.target !== undefined && { target: cleanTarget(patch.target) }),
    ...(patch.events !== undefined && { events: cleanEvents(patch.events) }),
    ...(patch.hint !== undefined && { hint: cleanHint(patch.hint) }),
    ...(patch.secret !== undefined && { secret: cleanSecret(patch.secret) }),
    ...(patch.provider !== undefined && { provider: cleanProvider(patch.provider) }),
    ...(patch.registered !== undefined && { registered: patch.registered }),
    updatedAt: now,
  };
  if (hooks.some((h, j) => j !== i && h.folder === next.folder && h.name.toLowerCase() === next.name.toLowerCase())) {
    throw new Error(`There's already a webhook “${next.name}” in this project.`);
  }
  hooks[i] = next;
  write(hooks);
  return next;
}

export function removeWebhook(id: string): Webhook | undefined {
  const hooks = read();
  const gone = hooks.find((h) => h.id === id);
  if (gone) write(hooks.filter((h) => h.id !== id));
  return gone;
}

// Its relay URL came back from Supabase (or went away, with neither).
export function setRelay(id: string, relay?: { relayId: string; url: string }, now = Date.now()): Webhook {
  const hooks = read();
  const [i, current] = requireHook(hooks, id);
  const next: Webhook = { ...current, relayId: relay?.relayId, url: relay?.url, updatedAt: now };
  if (!relay) {
    delete next.relayId;
    delete next.url;
  }
  hooks[i] = next;
  write(hooks);
  return next;
}

// A delivery the forwarder passed on; a webhook that gets one is registered, whatever it said before.
export function recordDelivery(id: string, delivery: Delivery): Webhook | undefined {
  const hooks = read();
  const i = hooks.findIndex((h) => h.id === id);
  const current = hooks[i];
  if (!current) return undefined;
  const next: Webhook = { ...current, registered: true, deliveries: [delivery, ...(current.deliveries ?? [])].slice(0, MAX_DELIVERIES) };
  hooks[i] = next;
  write(hooks);
  return next;
}
