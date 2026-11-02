// A headless Chromium for a Weft Worker's browser tools (docs/architecture/worker-browser.md): which binary, how it
// starts, and the one DevTools connection to it. The connection is a pipe (--remote-debugging-pipe), never a port: a
// port on 127.0.0.1 would let anything on the box, a thread's curl included, drive the browser past the file guard.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";

// A command whose failure changes nothing (an ack, a cleanup, a page already gone): sent, and any rejection dropped.
export function quietly(sent: Promise<unknown>): void {
  sent.catch(() => {});
}

// CDP over the pipe: one JSON message per NUL-terminated frame, both ways.
export function pipeReader(onMessage: (message: Record<string, unknown>) => void) {
  let held = "";
  return (chunk: Buffer | string) => {
    held += chunk.toString();
    let at: number;
    while ((at = held.indexOf("\0")) >= 0) {
      const raw = held.slice(0, at);
      held = held.slice(at + 1);
      try {
        onMessage(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        // A frame that isn't JSON isn't anything we asked for.
      }
    }
  };
}

export type CdpEvent = { method: string; params: Record<string, unknown>; sessionId?: string };

export interface Cdp {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<Record<string, unknown>>;
  on(listener: (event: CdpEvent) => void): () => void;
  onClose(listener: () => void): void;
  close(): void;
  readonly closed: boolean;
}

type Pending = { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void };

// A call the browser hasn't answered in this long fails, so a hung page can't hang a card's tool call for good.
export const CALL_MS = 60_000;

// A connection over a pair of streams; the browser process owns their lifetime.
export function cdpOver(out: Writable, inn: Readable, kill: () => void, callMs = CALL_MS): Cdp {
  let next = 0;
  let closed = false;
  const pending = new Map<number, Pending>();
  const listeners = new Set<(event: CdpEvent) => void>();
  const closers: Array<() => void> = [];
  const read = pipeReader((m) => {
    const id = typeof m.id === "number" ? m.id : undefined;
    const waiting = id === undefined ? undefined : pending.get(id);
    if (waiting) {
      pending.delete(id as number);
      const error = m.error as { message?: string } | undefined;
      if (error) waiting.reject(new Error(error.message ?? "The browser refused that."));
      else waiting.resolve((m.result ?? {}) as Record<string, unknown>);
      return;
    }
    if (typeof m.method !== "string") return;
    const event = { method: m.method, params: (m.params ?? {}) as Record<string, unknown>, ...(typeof m.sessionId === "string" ? { sessionId: m.sessionId } : {}) };
    listeners.forEach((l) => l(event));
  });
  const end = () => {
    if (closed) return;
    closed = true;
    pending.forEach((p) => p.reject(new Error("The worker's browser closed.")));
    pending.clear();
    closers.forEach((c) => c());
  };
  inn.on("data", read);
  inn.on("close", end);
  inn.on("error", end);
  out.on("error", end);
  return {
    get closed() {
      return closed;
    },
    send(method, params = {}, sessionId) {
      if (closed) return Promise.reject(new Error("The worker's browser closed."));
      const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`The worker's browser didn't answer ${method} in ${callMs / 1000}s.`));
        }, callMs);
        timer.unref();
        const settle = <T>(fn: (v: T) => void) => (v: T) => {
          clearTimeout(timer);
          fn(v);
        };
        pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
        out.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
      });
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onClose(listener) {
      closers.push(listener);
    },
    close() {
      kill();
      end();
    },
  };
}

// Where a Chromium might be: WEFT_CHROMIUM, the one install/worker.sh pins, Playwright's cached builds, then the
// system's Chrome or Chromium.
export function chromiumCandidates(env: NodeJS.ProcessEnv = process.env, home = os.homedir(), platform = process.platform): string[] {
  const own = path.join(home, ".weft", "tools", "chromium");
  const caches = platform === "darwin" ? path.join(home, "Library", "Caches", "ms-playwright") : path.join(home, ".cache", "ms-playwright");
  const shells = playwrightShells(caches);
  const system =
    platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
      : ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
  return [env.WEFT_CHROMIUM ?? "", path.join(own, "chrome-headless-shell"), ...shells, ...system].filter(Boolean);
}

// chromium_headless_shell-<rev>/chrome-headless-shell-<platform>/chrome-headless-shell, newest first.
function playwrightShells(caches: string) {
  let dirs: string[];
  try {
    dirs = fs.readdirSync(caches).filter((d) => d.startsWith("chromium_headless_shell-"));
  } catch {
    return [];
  }
  const rev = (d: string) => Number(d.split("-").pop()) || 0;
  return dirs
    .sort((a, b) => rev(b) - rev(a))
    .flatMap((d) => {
      try {
        return fs.readdirSync(path.join(caches, d)).map((sub) => path.join(caches, d, sub, "chrome-headless-shell"));
      } catch {
        return [];
      }
    });
}

export function findChromium(candidates = chromiumCandidates()): string | null {
  return candidates.find((file) => {
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  }) ?? null;
}

export const NO_CHROMIUM = "This worker has no Chromium for the browser tools. Run `weft-worker update` (install/worker.sh pins one), or set WEFT_CHROMIUM to a Chrome or chrome-headless-shell binary.";

// The flags: headless, nothing that phones home or asks, and no file access across files. A full Chrome takes
// --headless=new; chrome-headless-shell is headless already and ignores it. Root on Linux needs --no-sandbox.
export function chromiumArgs(dataDir: string, isRoot = process.getuid?.() === 0) {
  return [
    "--headless=new",
    "--remote-debugging-pipe",
    `--user-data-dir=${dataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--hide-scrollbars",
    "--mute-audio",
    "--window-size=1280,800",
    ...(isRoot ? ["--no-sandbox"] : []),
    "about:blank",
  ];
}

export type Spawn = (bin: string, args: string[]) => ChildProcess;
const spawnPiped: Spawn = (bin, args) => spawn(bin, args, { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });

// Starts one browser with a profile of its own, removed when it exits.
export function launchChromium(bin: string | null = findChromium(), run: Spawn = spawnPiped): Cdp {
  if (!bin) throw new Error(NO_CHROMIUM);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-browser-"));
  const child = run(bin, chromiumArgs(dataDir));
  const cdp = cdpOver(child.stdio[3] as Writable, child.stdio[4] as Readable, () => child.kill());
  const cleanUp = () => fs.rmSync(dataDir, { recursive: true, force: true });
  child.on("exit", () => {
    cdp.close();
    cleanUp();
  });
  child.on("error", () => {
    cdp.close();
    cleanUp();
  });
  return cdp;
}
