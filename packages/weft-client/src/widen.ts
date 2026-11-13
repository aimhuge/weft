// Signed widening (docs/architecture/project-hosts.md#signed-widening-as-built): what a network command may do on a
// host only with a fresh signature from a key that host pinned. A row or a line message is backed by nothing more than
// a Supabase session, so remoteRefusal (./host-command.ts) turns away whatever widens what a card can touch: a new
// folder, agent or read scope, skipping permission prompts, a "!" shell line, a terminal, a new thread with an agent.
// Each lifts when the command carries `widen`, an approval bound to exactly that action: the host, the card, the verb,
// the exact new value (the change below), a nonce and the time it was signed. The signature is the desktop's Touch ID
// key or a phone's (Ed25519, the shape of ./approval-sig.ts) or a passkey on sign.weft.zip (WebAuthn, the shape of
// lib/approval-passkey.ts); the host rebuilds this message from its own names and checks it against its pins.
// lib/widen.ts re-exports it; the host's check is lib/widen-check.ts.
import { isBang } from "./bang";
import { gooseFieldsOf } from "./host-settings";
import type { HostPayload } from "./host-row";

export const WIDEN_MESSAGE_V = "weft-widen-v1";
// How long a widening signature lives: long enough for the relay to deliver it, short enough that one left in a
// queue for a sleeping host is refused rather than run much later.
export const WIDEN_TTL_MS = 2 * 60_000;

// Exactly what a command widens, and to what. One key per widening, so a signature over one can't carry another.
export interface WidenChange {
  // card.update: the card's new folder (a project folder's name on a worker, a path on a Mac).
  cwd?: string;
  // card.update: the card's agent (its soul), or null to clear it.
  agent?: string | null;
  // card.update: skip permission prompts. The only mode that widens; any other is an ordinary change.
  permissionMode?: "bypassPermissions";
  // card.update: a folder the card may read from ("Read from" on a question).
  readScope?: unknown;
  // card.update: accept the SQL a review calls Safe without asking ("Allow safe SQL on this card").
  safeSql?: true;
  // card.shell: the command a "!" line runs.
  shell?: string;
  // card.schedule: a "!" line left to send later.
  schedule?: string;
  // A terminal in this project folder (its name on a worker), over the session line (lib/host-line-terminal.ts).
  terminal?: string;
  // A new thread with an agent (run / new_card): the agent, the folder it starts in and its first message.
  create?: { agent: string; folder: string; prompt: string };
  // settings.put on a worker: Goose's provider and endpoint (gooseProviderId, gooseBaseUrl), where a Goose card's
  // traffic goes. Only the desktop's Touch ID key signs it; a passkey can't (lib/widen-check.ts).
  goose?: Record<string, unknown>;
  // tree.snapshot on a Mac: send that Mac's uncommitted work in the project named `folder` (whose origin is the GitHub
  // repo `origin`) to its hidden ref on the remote (docs/architecture/wip-sync.md). Only a Mac it was paired with signs it.
  // `mac` is the asked Mac's name as the asking one knows it, for its Touch ID prompt; the asked Mac doesn't rely on it.
  wip?: { folder: string; origin: string; mac?: string };
}

// The verb a widening names in its message: a host verb, or the terminal and new-thread actions that aren't verbs, which
// name no card ("").
export type WidenVerb = HostPayload["verb"] | "terminal.open" | "card.create";

// The widening part of a host command, or null when it widens nothing. Mirrors remoteRefusal's rules.
// What a card.update body widens: its folder, agent and read scope, and skipping prompts (no other mode widens).
function updateChange(body: Record<string, unknown>): WidenChange {
  const change: WidenChange = {};
  if (body.cwd !== undefined) change.cwd = typeof body.cwd === "string" ? body.cwd : canonical(body.cwd);
  if (body.agent !== undefined) change.agent = typeof body.agent === "string" ? body.agent : null;
  if (body.permissionMode === "bypassPermissions") change.permissionMode = "bypassPermissions";
  if (body.readScope !== undefined) change.readScope = body.readScope;
  if (body.safeSql === true) change.safeSql = true;
  return change;
}

const textOf = (v: unknown) => (typeof v === "string" ? v : "");

function wipChange(args: Record<string, unknown>): NonNullable<WidenChange["wip"]> {
  const wip = { folder: textOf(args.folder), origin: textOf(args.origin) };
  return typeof args.mac === "string" ? { ...wip, mac: args.mac } : wip;
}

export function widenChangeOf({ verb, args }: { verb: string; args: Record<string, unknown> }): WidenChange | null {
  if (verb === "card.shell") return { shell: typeof args.command === "string" ? args.command : "" };
  if (verb === "card.schedule") return typeof args.text === "string" && isBang(args.text) ? { schedule: args.text } : null;
  // Only a Mac's ask carries the repo it's bound to; a worker's tree.snapshot widens nothing and goes unsigned.
  if (verb === "tree.snapshot") return typeof args.origin === "string" ? { wip: wipChange(args) } : null;
  if (verb === "settings.put") {
    const goose = gooseFieldsOf(args.patch);
    return goose ? { goose } : null;
  }
  if (verb !== "card.update" || !args.body || typeof args.body !== "object") return null;
  const change = updateChange(args.body as Record<string, unknown>);
  return Object.keys(change).length ? change : null;
}

// The rest of a host command an approval binds: its args without the approval and the card (which the message names on
// its own), so a row re-sent with the same approval and another title, mode, column or send-at time is refused.
export function widenArgsOf(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([key]) => key !== "widen" && key !== "id"));
}

const RUN_MODES = ["default", "acceptEdits", "auto", "plan"];
const BACKENDS = ["claude", "codex", "puku", "goose"];
const trimmed = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

// What a new thread is made of, as a host reads its run or new_card (lib/worker-commands.ts runBody): the terms its
// approval binds besides the agent and folder. The board signs these over its own input, the host over the row; both
// read them through this, so a relay row can't keep the approval and change the mode, CLI, model or repo.
export function createTerms(payload: unknown): Record<string, string> {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const terms: Record<string, string> = {};
  for (const key of ["prompt", "title", "model", "repo", "effort"]) {
    const value = trimmed(p[key]);
    if (value) terms[key] = value;
  }
  const backend = trimmed(p.backend);
  if (backend && BACKENDS.includes(backend)) terms.backend = backend;
  if (typeof p.permissionMode === "string" && RUN_MODES.includes(p.permissionMode)) terms.permissionMode = p.permissionMode;
  return terms;
}

// What a host signs over and checks: every field always present, so one approval has one encoding.
export interface WidenFields {
  // The host that runs it: a Mac's lib/device-id.ts id, or a worker's id.
  host: string;
  // The card it acts on; "" for a new thread, which has none yet.
  card: string;
  verb: WidenVerb;
  change: WidenChange;
  // The rest of the command, bound whole: widenArgsOf for a host verb, createTerms for a new thread, {} for a terminal.
  args: Record<string, unknown>;
  nonce: string;
  issuedAt: number;
}

// Keys sorted at every depth after a JSON round trip, so every signer and every host encode the same bytes.
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, sorted(obj[k])]));
  }
  return value;
}

export const canonical = (value: unknown) => JSON.stringify(sorted(JSON.parse(JSON.stringify(value ?? null))));

// The message a widening's signer signs (Ed25519 over it, or a passkey over its SHA-256). Its `v` keeps it from ever
// reading as an answer's message, the phone's lines or a passkey answer's JSON.
export const widenMessage = (f: WidenFields) =>
  canonical({ v: WIDEN_MESSAGE_V, host: f.host, card: f.card, verb: f.verb, change: f.change, args: f.args, nonce: f.nonce, issuedAt: f.issuedAt });

// What rides in the command as `widen` (args.widen on a host verb, payload.widen on a run, the terminal's open).
export type WidenAuth =
  | { kind: "ed25519"; device: string; issuedAt: number; nonce: string; sig: string }
  | { kind: "webauthn"; device: string; credId: string; issuedAt: number; nonce: string; authenticatorData: string; clientDataJSON: string; signature: string };

const NONCE = /^[A-Za-z0-9_-]{16,64}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

// The auth off the network, each field the type and shape it must be, or null.
export function readWidenAuth(raw: unknown): WidenAuth | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.issuedAt !== "number" || !Number.isFinite(a.issuedAt) || typeof a.nonce !== "string" || !NONCE.test(a.nonce) || !text(a.device, 200)) return null;
  const base = { device: a.device, issuedAt: a.issuedAt, nonce: a.nonce };
  if (a.kind === "ed25519") return text(a.sig, 200) && B64.test(a.sig) ? { kind: "ed25519", ...base, sig: a.sig } : null;
  if (a.kind !== "webauthn") return null;
  const parts = [a.credId, a.authenticatorData, a.clientDataJSON, a.signature];
  if (!parts.every((p) => text(p, 4096) && B64URL.test(p))) return null;
  const [credId, authenticatorData, clientDataJSON, signature] = parts as string[];
  return { kind: "webauthn", ...base, credId, authenticatorData, clientDataJSON, signature } as WidenAuth;
}

export const freshWiden = (issuedAt: number, now: number) => Math.abs(now - issuedAt) <= WIDEN_TTL_MS;

// The args a verb runs with: the approval is the host's to check, never the handler's to read.
export function withoutWiden<T extends Record<string, unknown>>(args: T): T {
  if (!("widen" in args)) return args;
  return Object.fromEntries(Object.entries(args).filter(([key]) => key !== "widen")) as T;
}

const cut = (s: string, max = 120) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

// One line saying what a widening does, for the Touch ID prompt and the sign sheet's title. The sheet shows the whole
// change beside it; this line is cut.
export function widenLabel(change: WidenChange): string {
  const parts: string[] = [];
  if (change.cwd !== undefined) parts.push(`move it to the folder ${cut(change.cwd)}`);
  if (change.agent !== undefined) parts.push(change.agent ? `give it the agent ${cut(change.agent, 60)}` : "clear its agent");
  if (change.permissionMode) parts.push("let it skip permission prompts");
  if (change.readScope !== undefined) parts.push(`let it read from ${cut(typeof change.readScope === "string" ? change.readScope : canonical(change.readScope))}`);
  if (change.safeSql) parts.push("let it run SQL a review calls Safe without asking");
  if (change.shell !== undefined) parts.push(`run the shell command ${cut(change.shell)}`);
  if (change.schedule !== undefined) parts.push(`schedule the shell line ${cut(change.schedule)}`);
  if (change.terminal !== undefined) parts.push(`open a terminal in ${cut(change.terminal, 60)}`);
  if (change.create) parts.push(`start a thread with the agent ${cut(change.create.agent, 60)} in ${cut(change.create.folder, 60)}`);
  if (change.goose) parts.push(gooseWords(change.goose));
  if (change.wip) parts.push(`send its uncommitted work in ${cut(change.wip.folder, 60)} to ${cut(change.wip.origin, 100)}`);
  return parts.join(", ") || "change nothing";
}

// A Goose change in words: the provider and the endpoint it sets ("" reads as its default).
function gooseWords(goose: Record<string, unknown>): string {
  const said = (v: unknown, none: string) => (typeof v === "string" && v ? cut(v) : none);
  const parts: string[] = [];
  if (goose.gooseProviderId !== undefined) parts.push(`the provider ${said(goose.gooseProviderId, "Goose's own")}`);
  if (goose.gooseBaseUrl !== undefined) parts.push(`the endpoint ${said(goose.gooseBaseUrl, "none")}`);
  return `point Goose at ${parts.join(" and ")}`;
}
