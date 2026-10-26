// The fakes and the types the pane-cdp tests share: a page's webContents and debugger, the CDP
// entries the buffers hold, and a typed facade over pane-cdp.cjs (whose CommonJS exports infer as
// `any` without a type declaration).

import { EventEmitter } from "node:events";
import { vi } from "vitest";
import { consoleEntry, createPaneCdp } from "./pane-cdp.cjs";

// One console line, as the page's buffer holds it.
export type ConsoleEntry = {
  level: string;
  text: string;
  at: string;
  time?: number;
};

// One failed request, as the page's network buffer holds it.
export type NetworkError = {
  status: number;
  method: string;
  url: string;
  type: string;
  error?: string;
  time?: number;
};

// The level filter consoleLogs() takes.
export type LogLevel = "all" | "warn" | "error";

// The part of a page the CDP session talks to.
export type FakeWebContents = EventEmitter & {
  debugger: FakeDebugger;
  destroyed: boolean;
  isDestroyed(): boolean;
};

export type FakeDebugger = EventEmitter & {
  isAttached(): boolean;
  attach(protocolVersion: string): void;
  detach(): void;
  sendCommand(method: string, params?: unknown): Promise<unknown>;
};

// A stand-in for a page's webContents: a debugger that speaks the CDP event names, and the
// did-navigate the pane listens for.
export function fakePage({ attached = false, destroyed = false } = {}) {
  const debugger_ = Object.assign(new EventEmitter(), {
    isAttached: () => attached,
    attach: vi.fn(() => {
      attached = true;
    }),
    detach: vi.fn(() => {
      attached = false;
    }),
    sendCommand: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(() => Promise.resolve({})),
  });
  const wc = Object.assign(new EventEmitter(), {
    debugger: debugger_,
    destroyed,
    isDestroyed() {
      return this.destroyed;
    },
  });
  // What Electron does when DevTools opens: the debugger drops the page and says so.
  const detachDebugger = () => {
    attached = false;
    debugger_.emit("detach");
  };
  return { wc, debugger: debugger_, detachDebugger };
}

// Sends a CDP event the way Electron's debugger does: (event, method, params).
export function emit(debugger_: EventEmitter, method: string, params: unknown) {
  debugger_.emit("message", {}, method, params);
}

// The shape of the CDP session pane-cdp.cjs builds, typed for the tests. The module is plain
// CommonJS without declarations, so its exports infer as `any`; these wrappers give them names.
export type PaneCdp = {
  attach(wc: FakeWebContents): unknown;
  send(wc: FakeWebContents, method: string, params?: unknown): Promise<unknown>;
  consoleLogs(wc: FakeWebContents, level?: LogLevel): ConsoleEntry[];
  networkErrors(wc: FakeWebContents): NetworkError[];
};

// A session, typed.
export function paneCdp(options?: { now?: () => number }): PaneCdp {
  return createPaneCdp(options);
}

// One console line, typed: undefined when the event isn't one the page's buffer holds.
export function entry(method: string, params: unknown): ConsoleEntry | undefined {
  return consoleEntry(method, params) as ConsoleEntry | undefined;
}
