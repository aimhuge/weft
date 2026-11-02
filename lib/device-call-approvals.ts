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

export interface ApprovalRow {
  id: string;
  worker_id: string;
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

// Touch ID, then the row as the owner: made for this worker, or reused when it is already this worker's, and stamped
// approved for this target until the hours run out. A row that's another host's (the Mac's own, another worker's) is refused.
export async function approveTunnel(client: SupabaseClient, row: ApprovalRow, deps: ApprovalDeps = DEPS): Promise<{ approved: boolean; until?: number }> {
  const a = argsOf(row);
  const tunnel = str(a.tunnel);
  if (!UUID.test(tunnel)) throw new Error("That tunnel has no id.");
  const target = localOrigin(a.target).origin;
  const hours = Math.min(Math.max(Number(a.hours) || 4, 0.25), 24);
  const name = await workerName(client, row.worker_id);
  const { approved } = (await deps.shell("/tunnels/approve", { folder: `${cleanWord(a.folder) || "a project"} on ${name}`, target, hours })) as { approved?: boolean };
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
  const sealed = (await deps.shell("/webhooks/relay-seal", { folder, name: secret, environment: "development", provider })) as Sealed;
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

export function runApproval(client: SupabaseClient, row: ApprovalRow, deps: ApprovalDeps = DEPS): Promise<unknown> {
  return row.tool === TUNNEL_TOOL ? approveTunnel(client, row, deps) : createWorkerRelay(client, row, deps);
}
