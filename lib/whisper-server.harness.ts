// The fakes the whisper server's tests run against: a fake child process, a fake port probe and a
// stubbed fetch. Nothing is spawned, no port is bound and no request leaves the process.
import { EventEmitter } from "node:events";
import { vi } from "vitest";

// The fake child: an EventEmitter that behaves like the parts of ChildProcess the module uses.
export class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  killed = false;
  kill(): boolean {
    this.killed = true;
    this.exitCode = 0;
    this.emit("exit", 0, null);
    return true;
  }
  // The module's "the child died on its own" path: exitCode set, exit emitted.
  die(code = 1) {
    this.exitCode = code;
    this.emit("exit", code, null);
  }
}

// The children the last load spawned, in order.
export const children: FakeChild[] = [];

export function resetChildren() {
  children.length = 0;
}

export function lastChild(): FakeChild {
  const child = children[children.length - 1];
  if (!child) throw new Error("No child spawned yet.");
  return child;
}

// The ports the fake probe hands out, one per call, so two servers get two ports.
export const ports = { next: 4321, current: 4321 };

export function resetPorts() {
  ports.next = 4321;
  ports.current = 4321;
}

export interface FetchOptions {
  /** Answer the readiness poll (any port) with 200. */
  ready?: boolean;
  /** Answer the readiness poll on this port only, and refuse the others. */
  readyPort?: number;
  /** The status the inference answers with. */
  status?: number;
  /** The text the inference answers with. */
  text?: string;
}

export interface FetchStub {
  calls: { url: string; init?: RequestInit }[];
  fetchMock: ReturnType<typeof vi.fn>;
}

// The fetch stub: answers the readiness GET and the POST /inference.
export function stubFetch(opts: FetchOptions = {}): FetchStub {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init });
    if (href.endsWith("/inference")) {
      const status = opts.status ?? 200;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(opts.text ?? "hello there"),
      } as unknown as Response);
    }
    // The readiness poll.
    if (opts.readyPort !== undefined && href !== `http://127.0.0.1:${opts.readyPort}/`) {
      return Promise.reject(new Error("connection refused"));
    }
    if (opts.ready === false) return Promise.reject(new Error("connection refused"));
    return Promise.resolve({ ok: true, status: 200 } as unknown as Response);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

// Lets the pending microtasks (the port probe, the spawn) settle.
export async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
