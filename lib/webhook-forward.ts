import type { RealtimeChannel } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { shell } from "./browser-tools";
import { recordExplore } from "./explore";
import { globalSingleton } from "./global-singleton";
import { HOOK_URL } from "./github-hooks";
import { getWebhook, listWebhooks, providerFor, recordDelivery, setRelay, webhookByRelay, type Webhook } from "./webhooks";
import type { DeliveryRow } from "./webhook-relay";

// Webhook relays, the local half (docs/architecture/webhooks.md). A webhook's relay URL is on the deployed Weft
// (lib/webhook-relay.ts), which saves what a provider posts as a webhook_deliveries row on Weft's Supabase. This
// server hears the row through Realtime, sends the request on to the webhook's target on localhost with the original
// method, headers and exact body bytes (so the provider's signature still checks out), records how it went
// (lib/webhooks.ts recordDelivery) and deletes the row, so payloads don't sit on Supabase.

// The relay is on the same deployment as the GitHub one (WEFT_RELAY_URL points both at another).
export const RELAY_ORIGIN = new URL(HOOK_URL).origin;
export const relayUrl = (relayId: string) => `${RELAY_ORIGIN}/api/hooks/${relayId}`;

export const FORWARD_TIMEOUT_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SIGN_IN = "Sign in to your Weft account first: relay URLs come through it.";
const NO_PROVIDER =
  "A relay URL only works when Weft knows the provider whose signature it will check. Name the webhook one of stripe, github, vercel or svix (Resend and Clerk are svix), or set its provider, then try again.";
const NO_SECRET =
  "A relay URL needs the provider's signing secret, so its deliveries can be checked. Record the vault name (e.g. STRIPE_WEBHOOK_SECRET) with mcp__webhooks__add_blank, fill it in, then try again.";
// Set by fetch itself, or meaningless on a new connection to localhost.
const NOT_FORWARDED = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive"]);

// A delivery row as the table has it.
export interface StoredDelivery extends DeliveryRow {
  id: number;
  created_at: string;
}

const live = () =>
  globalSingleton("__weftWebhookRelay", () => ({
    started: false,
    channel: null as RealtimeChannel | null,
    uid: null as string | null,
    // Rows being forwarded right now, so the drain and a Realtime event for the same row don't send it twice.
    busy: new Set<number>(),
  }));

async function userId(): Promise<string | null> {
  const { data } = await accountClient().auth.getSession();
  return data.session?.user.id ?? null;
}

// Whether you're signed in to Weft; false too when accounts aren't set up in this build.
export async function relaySignedIn(): Promise<boolean> {
  try {
    return Boolean(await userId());
  } catch {
    return false;
  }
}

function requireHook(id: string): Webhook {
  const hook = getWebhook(id);
  if (!hook) throw new Error("That webhook is gone.");
  return hook;
}

// Gives the webhook a public URL on the deployed Weft, and starts listening for what comes to it.
// The relay refuses anything that doesn't carry the provider's signature (lib/webhook-relay.ts), so a relay
// row needs a provider and its signing secret sealed for the deployment to verify with. The secret lives in
// the 🔐 vault; the desktop shell (Electron main) seals it and hands back only the ciphertext trio — the
// plaintext never reaches this server or the thread. Touch ID on every seal (vault.sendValue).
export async function createRelay(id: string): Promise<Webhook> {
  if (!(await relaySignedIn())) throw new Error(SIGN_IN);
  const hook = requireHook(id);
  if (hook.relayId) return hook;
  const provider = providerFor(hook);
  if (!provider) throw new Error(NO_PROVIDER);
  if (!hook.secret) throw new Error(NO_SECRET);
  // Seal the vault secret for the relay row. Denied or missing here means no relay, not an unsigned one.
  const sealed = (await shell("/webhooks/relay-seal", { folder: hook.folder, name: hook.secret, environment: "development", provider })) as {
    denied?: boolean;
    missing?: boolean;
    secret_ciphertext?: string;
    secret_nonce?: string;
    secret_key_id?: string;
  };
  if (sealed.denied) throw new Error("Weft didn't get your Touch ID, so no relay was created.");
  if (sealed.missing || !sealed.secret_ciphertext || !sealed.secret_nonce || !sealed.secret_key_id)
    throw new Error(`${hook.secret} has no value in the vault yet — add it in 🔐, then call relay again.`);
  const { data, error } = await accountClient()
    .from("webhook_relays")
    .insert({
      name: hook.name,
      provider,
      secret_ciphertext: sealed.secret_ciphertext,
      secret_nonce: sealed.secret_nonce,
      secret_key_id: sealed.secret_key_id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const relayId = String(data.id);
  const next = setRelay(id, { relayId, url: relayUrl(relayId) });
  await refreshWebhookRelay();
  return next;
}

// Takes the public URL away: the relay row goes (its undelivered rows with it). Signed out, there's only the local record to drop.
export async function removeRelay(id: string): Promise<Webhook> {
  const hook = requireHook(id);
  if (hook.relayId && (await relaySignedIn())) {
    const { error } = await accountClient().from("webhook_relays").delete().eq("id", hook.relayId);
    if (error) throw new Error(error.message);
  }
  const next = setRelay(id);
  await refreshWebhookRelay();
  return next;
}

// Where a delivery goes: the target with the path and query that followed the relay id. Built with URL, so a
// crafted path can never move it off the target's host.
export function targetUrl(target: string, extra: string): string {
  const url = new URL(target);
  const q = extra.indexOf("?");
  const sub = q < 0 ? extra : extra.slice(0, q);
  const query = q < 0 ? "" : extra.slice(q + 1);
  // A dot segment (even percent-encoded) would climb out of the target's path to any other route on this server.
  const climbs = sub.split("/").some((seg) => /^(\.|%2e){1,2}$/i.test(seg));
  if (sub.startsWith("/") && !climbs) url.pathname = `${url.pathname.replace(/\/$/, "")}${sub}`;
  if (query) url.search = url.search ? `${url.search}&${query}` : `?${query}`;
  return url.toString();
}

function failure(err: unknown): string {
  if ((err as Error).name === "TimeoutError") return `No answer in ${FORWARD_TIMEOUT_MS / 1000} s`;
  const cause = (err as { cause?: { code?: string } }).cause?.code;
  return cause ? `${(err as Error).message} (${cause})` : (err as Error).message;
}

async function forget(rowId: number) {
  const { error } = await accountClient().from("webhook_deliveries").delete().eq("id", rowId);
  if (error) console.warn(`Webhook delivery ${rowId}: couldn't delete it from Supabase: ${error.message}`);
}

// Sends one delivery on to its webhook's target, records how it went, and deletes the row. A delivery whose relay
// has no webhook here (removed, or on another Mac) is deleted with a warning. Never throws.
export async function forward(row: StoredDelivery): Promise<void> {
  const hook = webhookByRelay(row.relay_id);
  if (!hook) {
    console.warn(`Webhook relay ${row.relay_id}: no webhook here to deliver to, dropping delivery ${row.id}.`);
    await forget(row.id);
    return;
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(row.headers)) if (!NOT_FORWARDED.has(name.toLowerCase())) headers[name] = value;
  const body = Buffer.from(row.body, "base64");
  const started = Date.now();
  let status = 0;
  let error: string | undefined;
  try {
    const res = await fetch(targetUrl(hook.target, row.path), {
      method: row.method,
      headers,
      body: body.length && row.method !== "GET" ? body : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    status = res.status;
    // Not read; this only lets go of the connection.
    await res.body?.cancel().catch(() => {});
  } catch (err) {
    error = failure(err);
  }
  recordDelivery(hook.id, { at: started, method: row.method, status, ms: Date.now() - started, ...(error && { error }) });
  if (status) void recordExplore("webhook");
  await forget(row.id);
}

async function forwardOnce(row: StoredDelivery) {
  const { busy } = live();
  if (busy.has(row.id)) return;
  busy.add(row.id);
  try {
    await forward(row);
  } finally {
    busy.delete(row.id);
  }
}

// One delivery by id, from a Realtime event. The event's copy can be cut short for a big row, so the whole row is read back.
export async function forwardById(rowId: number) {
  const { data, error } = (await accountClient().from("webhook_deliveries").select("*").eq("id", rowId).maybeSingle()) as { data: StoredDelivery | null; error: { message: string } | null };
  if (error) {
    console.warn(`Webhook delivery ${rowId}: ${error.message}`);
    return;
  }
  // Already forwarded (and deleted) by the drain.
  if (data) await forwardOnce(data);
}

// Everything waiting under your account, oldest first: what arrived while Weft was closed or offline.
export async function drainDeliveries() {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const { data, error } = await accountClient().from("webhook_deliveries").select("*").gte("created_at", since).order("id", { ascending: true });
  if (error) {
    console.warn(`Webhook deliveries: ${error.message}`);
    return;
  }
  for (const row of data as StoredDelivery[]) await forwardOnce(row);
}

async function stopListening() {
  const g = live();
  if (g.channel) await accountClient().removeChannel(g.channel);
  g.channel = null;
  g.uid = null;
}

// One Realtime channel on your webhook_deliveries rows (the table's select policy keeps it to yours). Each time it
// (re)joins, it drains what came in while it wasn't joined.
async function listen() {
  const uid = await userId();
  const g = live();
  if (g.channel && g.uid === uid) return;
  await stopListening();
  if (!uid) return;
  g.uid = uid;
  g.channel = accountClient()
    .channel(`webhook-deliveries-${uid}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "webhook_deliveries", filter: `user_id=eq.${uid}` }, (change: { new: { id?: unknown } }) => {
      if (typeof change.new.id === "number") void forwardById(change.new.id);
    })
    .subscribe((status: string) => {
      if (status === "SUBSCRIBED") void drainDeliveries();
    });
}

// Listen while you're signed in and have a webhook with a relay; stop otherwise.
export async function refreshWebhookRelay() {
  try {
    if ((await relaySignedIn()) && listWebhooks().some((h) => h.relayId)) await listen();
    else await stopListening();
  } catch (err) {
    console.warn(`Webhook relay: ${(err as Error).message}`);
  }
}

// Once per server process (from prewarm()): follows sign-in and sign-out, starting with the session it has now.
export function startWebhookRelay() {
  const g = live();
  if (g.started) return;
  g.started = true;
  try {
    // supabase-js warns against awaiting its calls inside this callback, so the refresh runs after it.
    accountClient().auth.onAuthStateChange(() => void setTimeout(() => void refreshWebhookRelay(), 0));
  } catch {
    // Accounts aren't set up in this build: no relay to listen to.
  }
}
