// The wire of "Keep on this worker" (docs/architecture/secrets.md#kept-on-a-worker, project-hosts.md H8's last step):
// the Mac pushes a project's development or preview values to a paired Weft Worker, each one sealed to the worker's box
// key for its own slot and version, in a `vault_keep` command main signs with this Mac's device key. The worker takes
// only a command signed by the Mac its pairing code named (lib/worker-mac-keys.ts) and stores the sealed bytes as they
// came (lib/worker-kept-vault.ts): it opens one only when a fresh, Mac-signed secret_use names that name and version.
// electron/worker-keep-wire.cjs is main's copy of keepMessage and keptPurpose, held to this by a test.
import { canonical } from "./widen";
import { sealedOf, type Sealed } from "./worker-seal";

export const KEEP_KIND = "vault_keep";
export const KEEP_V = "weft-vault-keep-v1";
// A put adds values, so it's taken only fresh; a delete, drop or wipe only takes values away, so a late one still lands.
export const KEEP_MAX_AGE_MS = 10 * 60_000;
// Production values never stay on a worker: they travel per use, after Touch ID (electron/worker-kept.cjs refuses too).
export const KEEP_ENVIRONMENTS = ["development", "preview"] as const;
export const MAX_KEPT = 200;

export type KeepOp = "put" | "delete" | "drop" | "wipe";

export interface KeptEntry {
  name: string;
  version: number;
  sealed: Sealed;
}

// What the Mac signs. `seq` only grows (per worker, on the Mac), so an older command read off an earlier row is refused.
// repo is the vault's id as the Mac keys it (electron/vault-id.cjs): github:owner/name, lowercase. A put's entries are
// the environment's whole set, each sealed to this worker's box key for keptPurpose; a delete names names only.
interface KeepBase {
  worker: string;
  seq: number;
  issuedAt: number;
}
interface KeepAt {
  repo: string;
  environment: string;
}
type KeepBody = ({ op: "put"; entries: KeptEntry[] } & KeepAt) | ({ op: "delete"; names: string[] } & KeepAt) | ({ op: "drop" } & KeepAt) | { op: "wipe" };
export type Keep = KeepBase & KeepBody;

// Every field the message names, as main's copy (electron/worker-keep-wire.cjs) reads them.
export interface KeepFields extends KeepBase {
  op: KeepOp;
  repo?: string;
  environment?: string;
  entries?: KeptEntry[];
  names?: string[];
}

export const keepMessage = (k: KeepFields) =>
  canonical({ v: KEEP_V, worker: k.worker, seq: k.seq, issuedAt: k.issuedAt, op: k.op, repo: k.repo ?? null, environment: k.environment ?? null, entries: k.entries ?? null, names: k.names ?? null });

// What each kept value is sealed for: this worker, this vault, environment, name and version. A value sealed for another
// slot (or an older version of this one) won't open as this one.
export const keptPurpose = (worker: string, repo: string, environment: string, name: string, version: number) => `vault-keep:${worker}:${repo}:${environment}:${name}:${version}`;

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REPO = /^github:[a-z0-9._-]{1,100}\/[a-z0-9._-]{1,100}$/;
const ID = /^[A-Za-z0-9_:.-]{1,200}$/;
const KEY = /^[A-Za-z0-9+/]{4,200}={0,2}$/;
const OPS: readonly KeepOp[] = ["put", "delete", "drop", "wipe"];

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const whole = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
export const isKeptName = (v: unknown): v is string => typeof v === "string" && NAME.test(v);
export const isKeptRepo = (v: unknown): v is string => typeof v === "string" && REPO.test(v);
export const isKeptEnvironment = (v: unknown): v is string => KEEP_ENVIRONMENTS.some((e) => e === v);

function entriesOf(raw: unknown): KeptEntry[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_KEPT) return null;
  const out: KeptEntry[] = [];
  for (const e of raw) {
    const sealed = isObject(e) ? sealedOf(e.sealed) : null;
    if (!isObject(e) || !sealed || !isKeptName(e.name) || !whole(e.version)) return null;
    out.push({ name: e.name, version: e.version, sealed });
  }
  return new Set(out.map((e) => e.name)).size === out.length ? out : null;
}

function namesOf(raw: unknown): string[] | null {
  return Array.isArray(raw) && raw.length && raw.length <= MAX_KEPT && raw.every(isKeptName) ? [...new Set(raw)] : null;
}

// The op's own fields, each the shape it must be, or null.
function bodyOf(op: KeepOp, p: Record<string, unknown>): KeepBody | null {
  if (op === "wipe") return { op };
  if (!isKeptRepo(p.repo) || !isKeptEnvironment(p.environment)) return null;
  const at = { repo: p.repo, environment: p.environment };
  if (op === "drop") return { op, ...at };
  if (op === "delete") {
    const names = namesOf(p.names);
    return names ? { op, ...at, names } : null;
  }
  const entries = entriesOf(p.entries);
  return entries ? { op, ...at, entries } : null;
}

// The Mac's key and signature on a vault_keep, or null.
function macOf(payload: Record<string, unknown>): { key: string; sig: string } | null {
  const m = isObject(payload.mac) ? payload.mac : {};
  return typeof m.key === "string" && KEY.test(m.key) && typeof m.sig === "string" && KEY.test(m.sig) ? { key: m.key, sig: m.sig } : null;
}

// A vault_keep as the worker reads it off the network: the command and the Mac's signature, or null.
export function readKeep(payload: unknown): { keep: Keep; mac: { key: string; sig: string } } | null {
  const p = isObject(payload) && isObject(payload.keep) ? payload.keep : null;
  const mac = isObject(payload) ? macOf(payload) : null;
  if (!p || !mac) return null;
  const op = OPS.find((o) => o === p.op);
  if (!op || typeof p.worker !== "string" || !ID.test(p.worker) || !whole(p.seq) || !whole(p.issuedAt)) return null;
  const body = bodyOf(op, p);
  return body ? { keep: { worker: p.worker, seq: p.seq, issuedAt: p.issuedAt, ...body }, mac } : null;
}

// The versions a secret_use says to take from the worker's own copy (lib/secret-use.ts openedUse), or null.
export function keptVersions(raw: unknown): Record<string, number> | null {
  if (!isObject(raw)) return null;
  const entries = Object.entries(raw);
  if (entries.length > MAX_KEPT || !entries.every(([name, v]) => isKeptName(name) && whole(v))) return null;
  return Object.fromEntries(entries) as Record<string, number>;
}

// The vault id a checkout's git remote names, as electron/vault-id.cjs parseRemote makes it (held to it by a test), when
// it's a GitHub repo; null otherwise (a kept value is only ever looked up for a GitHub repo's vault).
export function repoOfRemote(remote: string): string | null {
  const m = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)[:/](.+?)(?:\.git)?\/?$/i.exec(remote.trim());
  const [, host = "", repo = ""] = m ?? [];
  if (host.toLowerCase() !== "github.com") return null;
  const id = `github:${repo.replace(/^\/+/, "").toLowerCase()}`;
  return isKeptRepo(id) ? id : null;
}
