// The board's part in a synced folder (docs/architecture/folder-sync.md): the window holds the session line to the
// worker, so it carries the `tree` channel between the worker's peer and this Mac's (in the server, /api/tree-sync).
// It knows nothing of files: it moves texts both ways.
//
//   up       the line comes up (or is up): a `tree` channel opens; its first text is the open main signed
//   opened   the worker took it: the server's peer starts, and two loops run, channel → POST in, long poll out → channel
//   refused  said in the log; the channel closes and isn't tried again until sync is turned on again or Weft restarts
//   down     the channel closed (the line dropped): the server's peer stops; the next time the line is up it opens again
import { apiFetch, API_HEADERS } from "./api-client";
import { lineFor, onLineFlips, retainLine } from "./session-lines";
import type { SessionLine } from "./session-line";
import { TREE_CHANNEL } from "./tree-sync-protocol";

export interface SyncTarget {
  workerId: string;
  folder: string;
  workerName?: string;
}

type Api = (body: Record<string, unknown>) => Promise<Record<string, unknown>>;

export interface PipeDeps {
  api: Api;
  line: (workerId: string) => SessionLine | null;
  log?: (msg: string) => void;
  // How much the channel may hold unsent before the out loop waits for it to drain.
  highWater?: number;
}

const HIGH_WATER = 1024 * 1024;
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

// One channel's life on one line: resolves when it ends.
export function pipe(t: SyncTarget, deps: PipeDeps): { done: Promise<"refused" | "closed">; stop: () => void } {
  const log = deps.log ?? (() => {});
  const body = (op: string, extra: Record<string, unknown> = {}) => ({ op, ...t, ...extra });
  const channel = deps.line(t.workerId)?.channel(TREE_CHANNEL) ?? null;
  let alive = Boolean(channel);
  let opened = false;
  let inbox: string[] = [];
  let flushing: Promise<unknown> | null = null;
  let end: (how: "refused" | "closed") => void = () => {};
  const done = new Promise<"refused" | "closed">((resolve) => (end = resolve));
  if (!channel) {
    end("closed");
    return { done, stop: () => {} };
  }
  const ch = channel;
  const finish = (how: "refused" | "closed") => {
    if (!alive) return;
    alive = false;
    if (opened) void deps.api(body("close")).catch(() => {});
    if (ch.readyState !== "closed") ch.close();
    end(how);
  };

  // Texts from the worker go to the server in batches, in order.
  function flush() {
    if (flushing || !inbox.length) return;
    const texts = inbox;
    inbox = [];
    flushing = deps
      .api(body("in", { texts }))
      .catch((err: unknown) => log(`folder sync: ${(err as Error).message}`))
      .finally(() => {
        flushing = null;
        flush();
      });
  }

  async function outLoop() {
    // Read through a call: it changes across each await.
    const live = () => alive && ch.readyState === "open";
    while (live()) {
      const r = await deps.api(body("out")).catch(() => null);
      if (!r) {
        await wait(1_000);
        continue;
      }
      for (const text of Array.isArray(r.texts) ? (r.texts as string[]) : []) {
        while (live() && ch.bufferedAmount > (deps.highWater ?? HIGH_WATER)) await wait(50);
        if (!live()) return;
        ch.send(text);
      }
    }
  }

  ch.onopen = () =>
    void deps
      .api(body("open"))
      .then((r) => alive && ch.send(String(r.open)))
      .catch((err: unknown) => {
        log(`folder sync of ${t.folder}: ${(err as Error).message}`);
        finish("refused");
      });
  ch.onmessage = (e: MessageEvent) => {
    const text = String(e.data);
    if (opened) {
      inbox.push(text);
      flush(); return;
    }
    let first: { t?: string; message?: string } = {};
    try {
      first = JSON.parse(text) as typeof first;
    } catch {
      /* not a reply */
    }
    if (first.t === "refused") {
      log(`folder sync of ${t.folder}: ${first.message ?? "refused"}`);
      finish("refused"); return;
    }
    if (first.t !== "opened") return;
    void deps.api(body("opened")).then(
      () => {
        opened = true;
        void outLoop();
      },
      (err: unknown) => {
        log(`folder sync of ${t.folder}: ${(err as Error).message}`);
        finish("refused");
      },
    );
  };
  ch.onclose = () => finish("closed");
  return { done, stop: () => finish("closed") };
}

// Keeps each folder synced while Weft runs: holds its worker's line, and opens a pipe each time the line is up.
export function keepSynced(targets: SyncTarget[], deps: PipeDeps & { retain?: (workerId: string) => () => void; flips?: typeof onLineFlips }): () => void {
  const retain = deps.retain ?? retainLine;
  const flips = deps.flips ?? onLineFlips;
  const pipes = new Map<string, { stop: () => void }>();
  const refused = new Set<string>();
  const keyOf = (t: SyncTarget) => `${t.workerId}/${t.folder}`;
  const start = (t: SyncTarget) => {
    const k = keyOf(t);
    if (pipes.has(k) || refused.has(k) || !deps.line(t.workerId)?.up()) return;
    const p = pipe(t, deps);
    pipes.set(k, p);
    void p.done.then((how) => {
      if (pipes.get(k) === p) pipes.delete(k);
      if (how === "refused") refused.add(k);
    });
  };
  const releases = targets.map((t) => retain(t.workerId));
  const off = flips((workerId, direct) => {
    if (direct) targets.filter((t) => t.workerId === workerId).forEach(start);
  });
  targets.forEach(start);
  return () => {
    off();
    pipes.forEach((p) => p.stop());
    pipes.clear();
    releases.forEach((release) => release());
  };
}

// The real route, from Weft's own window.
export const treeSyncApi: Api = async (body) => {
  const res = await apiFetch("/api/tree-sync", { method: "POST", headers: API_HEADERS, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
  return data;
};

export const realPipeDeps = (): PipeDeps => ({ api: treeSyncApi, line: lineFor, log: (m) => console.info(m) });
