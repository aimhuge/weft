// The Mac's half of a worker's tunnel and relay (docs/architecture/tunnels.md#on-a-worker): a worker card asks with a
// device call (lib/worker-mac-ask.ts) and the inbox runs it here, after the user's Touch ID. The row is untrusted: only
// worker_mac_ask made it, so worker_id and card_id are the database's, but every arg is the worker's word, so each is
// re-checked and nothing from it reaches a prompt uncleaned. What this writes, it writes as the signed-in owner.
import type { SupabaseClient } from "@supabase/supabase-js";
import { shell } from "./browser-shell";
import { localRepos } from "./repos";
import { relayUrl } from "./webhook-forward";

export const TUNNEL_TOOL = "tunnel_open";
export const RELAY_TOOL = "relay_create";
export const APPROVAL_TOOLS: ReadonlySet<string> = new Set([TUNNEL_TOOL, RELAY_TOOL]);

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d{1,5}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const PROVIDERS = new Set(["stripe", "github", "vercel", "svix"]);
const HOUR_MS = 60 * 60 * 1000;
// After a Touch ID that was declined, a worker's next ask waits this long, so a thread can't ask again and again.
export const DENY_COOLDOWN_MS = 2 * 60_000;

export interface ApprovalRow {
  id: string;
  worker_id: string;
  // The account the call is for (the database's, from worker_mac_ask), which is the one signed in here.
  owner_user: string;
  card_id: string;
  tool: string;
  args: unknown;
}

export interface ApprovalDeps {
  shell: typeof shell;
  repos: () => { path: string; github?: string }[];
  now: () => number;
}

const DEPS: ApprovalDeps = { shell, repos: () => localRepos(), now: Date.now };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

// Letters, digits and a little punctuation, short: what a worker's word may add to a Touch ID prompt.
export const cleanWord = (v: unknown) =>
  str(v)
    .replace(/[^\p{L}\p{N} ._:()/-]/gu, "")
    .slice(0, 60);

const argsOf = (row: ApprovalRow): Record<string, unknown> => (row.args && typeof row.args === "object" && !Array.isArray(row.args) ? (row.args as Record<string, unknown>) : {});

function localOrigin(raw: unknown): URL {
  const text = str(raw);
  const url = URL.canParse(text) ? new URL(text) : null;
  if (!url || !LOCAL_ORIGIN.test(url.origin)) throw new Error("A worker's tunnel only reaches a server on the worker's own localhost.");
  return url;
}

async function workerName(client: SupabaseClient, workerId: string): Promise<string> {
  const { data } = (await client.from("cloud_workers").select("name").eq("id", workerId).maybeSingle()) as { data: { name?: string } | null };
  return cleanWord(data?.name) || "your worker";
}

// Per worker, on this Mac: one Touch ID prompt at a time, and a wait after a no. Held in memory, so it needs no
// migration; a restart of Weft clears it, which only lets one more prompt through.
const busy = new Set<string>();
const declinedUntil = new Map<string, number>();

export function resetPromptLimits() {
  busy.clear();
  declinedUntil.clear();
}

async function limited<T extends { approved?: boolean; denied?: boolean }>(workerId: string, now: () => number, run: () => Promise<T>): Promise<T> {
  const wait = (declinedUntil.get(workerId) ?? 0) - now();
  if (wait > 0) throw new Error(`You declined this worker's last Touch ID prompt, so it can't ask again for ${Math.ceil(wait / 1000)} s.`);
  if (busy.has(workerId)) throw new Error("This worker already has a Touch ID prompt open on this Mac.");
  busy.add(workerId);
  try {
    const answer = await run();
    if (answer.approved === false || answer.denied) declinedUntil.set(workerId, now() + DENY_COOLDOWN_MS);
    return answer;
  } finally {
    busy.delete(workerId);
  }
}

// A tunnel or relay is only for the account signed in here and a card it owns on a worker it owns: another member of
// the workspace can't have their ask run on this Mac. (Their command never reaches the worker either: worker_pending
// takes only the owner's, and OWNER_VERBS refuses dev.open from anyone else.)
export async function requireOwn(client: SupabaseClient, row: ApprovalRow): Promise<void> {
  const worker = (await client.from("cloud_workers").select("owner_user").eq("id", row.worker_id).maybeSingle()) as { data: { owner_user?: string } | null };
  if (!row.owner_user || worker.data?.owner_user !== row.owner_user) throw new Error("That worker isn't yours.");
  const card = (await client.from("cloud_cards").select("owner_user, owner_worker").eq("card_id", row.card_id).eq("owner_worker", row.worker_id).maybeSingle()) as { data: { owner_user?: string } | null };
  if (card.data?.owner_user !== row.owner_user) throw new Error("That thread isn't one of yours on this worker.");
}

// Touch ID, then the row as the owner: made for this worker, or reused when it is already this worker's, and stamped
// approved for this target until the hours run out. A row that's another host's (the Mac's own, another worker's) is refused.
export async function approveTunnel(client: SupabaseClient, row: ApprovalRow, deps: ApprovalDeps = DEPS): Promise<{ approved: boolean; until?: number }> {
  const a = argsOf(row);
  const tunnel = str(a.tunnel);
  if (!UUID.test(tunnel)) throw new Error("That tunnel has no id.");
  const target = localOrigin(a.target).origin;
  const hours = Math.min(Math.max(Number(a.hours) || 4, 0.25), 24);
  const name = await workerName(client, row.worker_id);
  // main names the worker by the name it pinned (electron/worker-label.cjs); this name is the row's, shown only if none is.
  const { approved } = (await deps.shell("/tunnels/approve", { folder: cleanWord(a.folder) || "a project", target, hours, worker: row.worker_id, workerName: name })) as { approved?: boolean };
  if (!approved) return { approved: false };
  const { data, error } = (await client.from("tunnels").select("id, worker_id").eq("id", tunnel).maybeSingle()) as { data: { worker_id: string | null } | null; error: { message: string } | null };
  if (error) throw new Error(error.message);
  if (data && data.worker_id !== row.worker_id) throw new Error("That address belongs to another host.");
  if (!data) {
    const made = await client.from("tunnels").insert({ id: tunnel, name: `${name} ${new URL(target).host}`, worker_id: row.worker_id });
    if (made.error) throw new Error(made.error.message);
  }
  const until = deps.now() + hours * HOUR_MS;
  const stamped = await client.from("tunnels").update({ approved_target: target, approved_until: new Date(until).toISOString() }).eq("id", tunnel);
  if (stamped.error) throw new Error(stamped.error.message);
  return { approved: true, until };
}

interface Sealed {
  denied?: boolean;
  missing?: boolean;
  secret_ciphertext?: string;
  secret_nonce?: string;
  secret_key_id?: string;
}

// The relay row for a worker's webhook: the signing secret sealed from this Mac's vault for the repo after Touch ID
// (electron's relay-seal, the same as a Mac's own relay), then inserted as the owner, naming the worker and its server.
// Deliveries go through that worker's tunnel to the server; with none open the provider is told to retry.
// A relay ask's args, each checked, or a throw that says which isn't right.
function relayArgs(row: ApprovalRow, deps: ApprovalDeps) {
  const a = argsOf(row);
  const provider = str(a.provider);
  const secret = str(a.secret);
  const repo = str(a.repo);
  if (!PROVIDERS.has(provider)) throw new Error("Unknown provider.");
  if (!SECRET_NAME.test(secret)) throw new Error("That signing secret's name isn't a vault name.");
  if (!REPO.test(repo)) throw new Error("A worker's relay needs its checkout's GitHub repo, which names the vault.");
  const target = localOrigin(a.target);
  const folder = deps.repos().find((r) => r.github?.toLowerCase() === repo.toLowerCase())?.path;
  if (!folder) throw new Error(`This Mac has no clone of ${repo}, so its 🔐 vault can't seal ${secret}. Open the project on this Mac once, then try again.`);
  return { name: cleanWord(a.name) || provider, provider, secret, target, folder };
}

const isSealed = (s: Sealed): s is Required<Pick<Sealed, "secret_ciphertext" | "secret_nonce" | "secret_key_id">> => Boolean(s.secret_ciphertext && s.secret_nonce && s.secret_key_id);

export async function createWorkerRelay(client: SupabaseClient, row: ApprovalRow, deps: ApprovalDeps = DEPS): Promise<{ relayId?: string; url?: string; denied?: boolean; missing?: boolean }> {
  const { name, provider, secret, target, folder } = relayArgs(row, deps);
  const workerLabel = await workerName(client, row.worker_id);
  const sealed = (await deps.shell("/webhooks/relay-seal", { folder, name: secret, environment: "development", provider, worker: row.worker_id, workerName: workerLabel })) as Sealed;
  if (sealed.denied) return { denied: true };
  if (sealed.missing || !isSealed(sealed)) return { missing: true };
  const open = (await client.from("tunnels").select("id").eq("worker_id", row.worker_id).eq("approved_target", target.origin).not("public_url", "is", null).limit(1)) as { data: { id: string }[] | null };
  const { data, error } = (await client
    .from("webhook_relays")
    .insert({
      name,
      provider,
      secret_ciphertext: sealed.secret_ciphertext,
      secret_nonce: sealed.secret_nonce,
      secret_key_id: sealed.secret_key_id,
      worker_id: row.worker_id,
      worker_origin: target.origin,
      tunnel_path: target.pathname,
      tunnel_id: open.data?.[0]?.id ?? null,
    })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };
  if (error || !data) throw new Error(error?.message ?? "The relay wasn't saved.");
  return { relayId: data.id, url: relayUrl(data.id) };
}

export async function runApproval(client: SupabaseClient, row: ApprovalRow, deps: ApprovalDeps = DEPS): Promise<unknown> {
  await requireOwn(client, row);
  const run = (): Promise<{ approved?: boolean; denied?: boolean }> => (row.tool === TUNNEL_TOOL ? approveTunnel(client, row, deps) : createWorkerRelay(client, row, deps));
  return limited(row.worker_id, deps.now, run);
}
