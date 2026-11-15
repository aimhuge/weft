// One end of a synced folder (docs/architecture/folder-sync.md): a checkout, the engine, and a `tree` channel to the
// other end. The same code runs on a Weft Worker and on this Mac, so either end can be either.
//
//   hello     each end sends its branch, HEAD, priority and every path not at HEAD; when both are in and the commits
//             match, each runs the engine over the pair and sends what it should. A hello comes again after this end's
//             branch or HEAD moves; the other end answers it with a fresh one of its own.
//   live      the watcher's paths, batched, go through engine.local; changes coming in through engine.remote, one at a
//             time in the order sent, read fresh just before each write
//   paused    the commits differ (a commit, a pull, a checkout on one end): nothing moves until they match again, and
//             the bases are dropped when HEAD moves, since they were relative to it
//
// Bases persist in the checkout's .git (weft-sync/<other end>.json), so a line that drops and comes back doesn't mistake
// a change made while apart for a clash.
import { promises as fs } from "node:fs";
import path from "node:path";
import { createEngine, wins, type Outgoing } from "./tree-sync-engine";
import type { TreeFs } from "./tree-sync-fs";
import { frame, unframer, type Files, type SyncMessage } from "./tree-sync-protocol";

export type SyncStatus =
  | { kind: "connecting" }
  | { kind: "synced"; at: number; sent: number; took: number; copies: string[] }
  | { kind: "paused"; reason: string };

export interface PeerDeps {
  fs: TreeFs;
  // This end's id (a device or worker id) and the name a conflict copy carries.
  self: { id: string; label: string };
  // The other end's id, and its name for messages.
  other: { id: string; label: string };
  send: (text: string) => void;
  // How much this end's version counts now: more while threads run here (lib/tree-sync-prio.ts).
  prio: () => number;
  gitDir: string;
  onStatus?: (status: SyncStatus) => void;
  // How often to check the branch, HEAD and priority, and to rescan the whole folder as a safety net.
  checkMs?: number;
  rescanMs?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

const short = (sha: string) => sha.slice(0, 7);

export function createPeer(deps: PeerDeps) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const read = unframer();
  const baseFile = path.join(deps.gitDir, "weft-sync", `${deps.other.id.replace(/[^A-Za-z0-9-]/g, "")}.json`);
  let theirPrio = 0;
  const engine = createEngine(() => wins({ prio: deps.prio(), id: deps.self.id }, { prio: theirPrio, id: deps.other.id }));
  let where: { branch: string; head: string } | null = null;
  let mine: Files = {};
  let theirs: { branch: string; head: string; files: Files } | null = null;
  let sentSinceHeard = false;
  let live = false;
  let stopped = false;
  let frag = 0;
  const stats = { sent: 0, took: 0, copies: [] as string[] };
  let queue: Promise<unknown> = Promise.resolve();
  const timers: ReturnType<typeof setInterval>[] = [];

  const status = (s: SyncStatus) => deps.onStatus?.(s);
  const synced = () => live && status({ kind: "synced", at: now(), ...stats });
  const post = (m: SyncMessage) => frame(m, `f${frag++}`).forEach((t) => deps.send(t));
  // One thing at a time, in order: messages, watcher batches and checks never interleave.
  const serial = (task: () => Promise<unknown>) => {
    const next = queue.then(task).catch((err: unknown) => log(`folder sync: ${(err as Error).message}`));
    queue = next;
    return next;
  };

  async function loadBases(head: string) {
    const saved = await fs.readFile(baseFile, "utf8").then((t) => JSON.parse(t) as { head?: string; files?: Files }, () => null);
    return saved?.head === head && saved.files ? saved.files : {};
  }
  let saving: ReturnType<typeof setTimeout> | undefined;
  function saveBases() {
    clearTimeout(saving);
    saving = setTimeout(() => {
      if (!where) return;
      const body = JSON.stringify({ head: where.head, files: engine.saved() });
      void fs.mkdir(path.dirname(baseFile), { recursive: true }).then(() => fs.writeFile(baseFile, body)).catch(() => {});
    }, 500);
  }

  async function out(o: Outgoing) {
    const data = typeof o.state === "string" && o.state !== "HEAD" ? (await deps.fs.read(o.path)).toString("base64") : undefined;
    post({ t: "change", ...o, ...(data === undefined ? {} : { data }) });
    stats.sent++;
  }

  async function hello() {
    where = await deps.fs.where();
    if (!where.branch) { pause("This project isn't on a branch (detached HEAD), so it can't sync."); return; }
    mine = await deps.fs.changed();
    post({ t: "hello", branch: where.branch, head: where.head, prio: deps.prio(), files: mine });
    sentSinceHeard = true;
  }

  function pause(reason: string) {
    live = false;
    status({ kind: "paused", reason });
  }

  // Both hellos in: run the engine over the pair, then catch whatever moved here since ours went.
  async function begin() {
    if (!where || !theirs) return;
    if (!where.branch) return;
    if (theirs.branch !== where.branch) { pause(`${deps.other.label} is on ${theirs.branch} and this side is on ${where.branch}. Switch one of them to sync again.`); return; }
    if (theirs.head !== where.head)
      { pause(`${deps.other.label} is at ${short(theirs.head)} and this side at ${short(where.head)}. Push and pull so both are on the same commit to sync again.`); return; }
    const sends = engine.start(mine, theirs.files);
    live = true;
    for (const o of sends) await out(o);
    await scan(Object.keys(await deps.fs.changed()).concat(Object.keys(engine.saved())));
    saveBases();
    synced();
  }

  // Paths that may have changed here: each one that moved off its base goes out.
  async function scan(paths: string[]) {
    if (!live) return;
    const states = new Map<string, Awaited<ReturnType<TreeFs["state"]>>>();
    for (const p of new Set(paths)) states.set(p, await deps.fs.state(p));
    let moved = 0;
    for (const [p, state] of states) {
      if (state === undefined) continue;
      const o = engine.local(p, state);
      if (o) {
        await out(o);
        moved++;
      }
    }
    if (moved) {
      saveBases();
      synced();
    }
  }

  async function take(m: Extract<SyncMessage, { t: "change" }>) {
    if (!live) return;
    const current = await deps.fs.state(m.path);
    // A path that doesn't sync here (ignored, a secret, too big): never written from the other end.
    if (current === undefined) { log(`folder sync: ${m.path} doesn't sync here; left as it is`); return; }
    const d = engine.remote(m, current);
    if (d.kind === "keep") await out(d.reply);
    if (d.kind === "take") {
      const copy = d.keepCopy ? await deps.fs.copyAside(m.path, deps.self.label) : null;
      await deps.fs.write(m.path, m.state, m.data === undefined ? undefined : Buffer.from(m.data, "base64"));
      stats.took++;
      // The copy is new work here like any other: it goes to the other end too.
      if (copy) {
        stats.copies = [...stats.copies, copy].slice(-20);
        await scan([copy]);
      }
    }
    saveBases();
    synced();
  }

  async function heard(m: SyncMessage) {
    if (m.t === "prio") theirPrio = m.prio;
    else if (m.t === "pause") pause(`${deps.other.label}: ${m.reason}`);
    else if (m.t === "change") await take(m);
    else {
      theirPrio = m.prio;
      theirs = m;
      if (!sentSinceHeard) await hello();
      sentSinceHeard = false;
      await begin();
    }
  }

  // The branch, HEAD and priority, every checkMs: a move pauses, drops the bases if HEAD moved, and says hello again.
  let lastPrio = deps.prio();
  async function check() {
    const p = deps.prio();
    if (p !== lastPrio) post({ t: "prio", prio: (lastPrio = p) });
    const at = await deps.fs.where();
    if (!where || (at.branch === where.branch && at.head === where.head)) return;
    if (at.head !== where.head) engine.forget();
    live = false;
    post({ t: "pause", reason: `it moved to ${at.branch || "a detached HEAD"} at ${short(at.head)}` });
    status({ kind: "connecting" });
    await hello();
    await begin();
  }

  return {
    async start() {
      status({ kind: "connecting" });
      const at = await deps.fs.where();
      for (const [p, s] of Object.entries(await loadBases(at.head))) engine.local(p, s);
      await serial(hello);
      timers.push(setInterval(() => void serial(check), deps.checkMs ?? 2_000));
      timers.push(setInterval(() => void serial(async () => live && scan(Object.keys(await deps.fs.changed()).concat(Object.keys(engine.saved())))), deps.rescanMs ?? 15_000));
    },
    // A text from the channel.
    receive(raw: string) {
      if (stopped) return;
      const m = read(raw);
      if (m) void serial(() => heard(m));
    },
    // Paths the watcher saw change (repo-relative); a folder that went brings the paths under it.
    touched(paths: string[]) {
      if (stopped) return Promise.resolve();
      return serial(() => {
        const saved = Object.keys(engine.saved());
        const all = paths.flatMap((p) => [p, ...saved.filter((s) => s.startsWith(`${p}/`))]);
        return scan(all.filter(deps.fs.syncs));
      });
    },
    // Everything queued so far has run (tests, and a clean stop).
    idle: () => queue.then(() => {}),
    stop() {
      stopped = true;
      live = false;
      timers.forEach(clearInterval);
      clearTimeout(saving);
    },
  };
}

export type SyncPeer = ReturnType<typeof createPeer>;
