// The `tree` channel's wire (docs/architecture/folder-sync.md): two checkouts of one project kept as one folder, over
// a WebRTC data channel. Both ends speak the same messages, so a worker, this Mac or (later) another Mac is the same
// peer; the engine (lib/tree-sync-engine.ts) decides what to send and what to take.
//
// A path's state is where its file stands against the commit both ends share (HEAD):
//   "HEAD"   as HEAD has it (unchanged, or absent from both HEAD and the folder)
//   null     deleted, though HEAD has it
//   <sha>    other bytes: the git blob id of what's on disk
//
//   hello   both ways, first   { branch, head, prio, files: { path: state } }  every path not at "HEAD"
//   change  both ways          { path, state, base, data?, conflict? }  a path moved from `base` to `state`; `data` is
//                              the file's bytes in base64 when `state` is a sha. `conflict`: the sender won a clash over it
//   prio    both ways          { prio }  how much this end's version counts now (threads running here count more)
//   pause   both ways          { reason }  this end stopped syncing (another branch or commit); a hello resumes
//   frag    both ways          { id, i, n, s }  one piece of a message too big for one DataChannel message
//
// A message one side can't read is dropped, never half-applied.

// "HEAD" is one of the strings, named apart for the reader.
export type FileState = string | null;
export type Files = Record<string, FileState>;

export type SyncMessage =
  | { t: "hello"; branch: string; head: string; prio: number; files: Files }
  | { t: "change"; path: string; state: FileState; base: FileState; data?: string; conflict?: true }
  | { t: "prio"; prio: number }
  | { t: "pause"; reason: string };

export const TREE_CHANNEL = "tree";
// What one DataChannel message carries at most, as the terminal's (lib/host-line-terminal.ts).
export const CHUNK = 16_000;
// A file bigger than this doesn't sync: a build output or a video the project forgot to ignore.
export const MAX_FILE = 20 * 1024 * 1024;
// Pieces of one message held at once, so a peer can't make the other buffer without end.
export const MAX_FRAGS = Math.ceil((MAX_FILE * 4) / 3 / CHUNK) + 64;

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const HEX = /^[0-9a-f]{40,64}$/;

// A repo-relative path with forward slashes that stays inside the folder and out of .git.
export function safePath(p: unknown): p is string {
  if (typeof p !== "string" || !p || p.length > 1024 || p.includes("\0") || p.includes("\\")) return false;
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return false;
  const parts = p.split("/");
  return parts.every((part) => part && part !== "." && part !== "..") && parts[0] !== ".git";
}

export const isState = (v: unknown): v is FileState => v === "HEAD" || v === null || (typeof v === "string" && SHA.test(v));

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const prio = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1000;

function files(v: unknown): Files | null {
  if (!isObject(v)) return null;
  const out: Files = {};
  for (const [p, state] of Object.entries(v)) {
    if (!safePath(p) || !isState(state)) return null;
    out[p] = state;
  }
  return out;
}

function change(p: Record<string, unknown>): SyncMessage | null {
  if (!safePath(p.path) || !isState(p.state) || !isState(p.base)) return null;
  const isSha = typeof p.state === "string" && p.state !== "HEAD";
  // Bytes go with a sha and only with one.
  if (isSha !== (typeof p.data === "string")) return null;
  return {
    t: "change",
    path: p.path,
    state: p.state,
    base: p.base,
    ...(typeof p.data === "string" ? { data: p.data } : {}),
    ...(p.conflict === true ? { conflict: true as const } : {}),
  };
}

function hello(p: Record<string, unknown>): SyncMessage | null {
  const f = files(p.files);
  if (typeof p.branch !== "string" || !p.branch || typeof p.head !== "string" || !HEX.test(p.head) || !prio(p.prio) || !f) return null;
  return { t: "hello", branch: p.branch, head: p.head, prio: p.prio, files: f };
}

export function readSyncMessage(raw: string): SyncMessage | null {
  let p: unknown;
  try {
    p = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(p)) return null;
  if (p.t === "hello") return hello(p);
  if (p.t === "change") return change(p);
  if (p.t === "prio") return prio(p.prio) ? { t: "prio", prio: p.prio } : null;
  if (p.t === "pause") return typeof p.reason === "string" && p.reason ? { t: "pause", reason: p.reason.slice(0, 300) } : null;
  return null;
}

// Splits a message into DataChannel-sized texts: itself when it fits, else frags that join back into it.
export function frame(message: SyncMessage, id: string): string[] {
  const text = JSON.stringify(message);
  if (text.length <= CHUNK) return [text];
  const n = Math.ceil(text.length / CHUNK);
  return Array.from({ length: n }, (_, i) => JSON.stringify({ t: "frag", id, i, n, s: text.slice(i * CHUNK, (i + 1) * CHUNK) }));
}

function fragOf(p: Record<string, unknown>): { id: string; i: number; n: number; s: string } | null {
  const { id, i, n, s } = p;
  if (typeof id !== "string" || typeof s !== "string" || typeof i !== "number" || typeof n !== "number" || n < 2 || n > MAX_FRAGS) return null;
  return { id, i, n, s };
}

// Joins frags back into whole messages, in the order they came (a DataChannel here is ordered and reliable). Returns
// a function that takes one received text and gives back the whole message it completes, or null.
export function unframer() {
  let open: { id: string; n: number; parts: string[] } | null = null;
  return (raw: string): SyncMessage | null => {
    let p: unknown;
    try {
      p = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!isObject(p) || p.t !== "frag") return readSyncMessage(raw);
    const f = fragOf(p);
    if (!f) return (open = null);
    if (f.i === 0) open = { id: f.id, n: f.n, parts: [] };
    // A piece out of turn drops the message it belonged to.
    if (!open || open.id !== f.id || open.n !== f.n || open.parts.length !== f.i) return (open = null);
    open.parts.push(f.s);
    const { n } = f;
    if (open.parts.length < n) return null;
    const whole = open.parts.join("");
    open = null;
    return readSyncMessage(whole);
  };
}
