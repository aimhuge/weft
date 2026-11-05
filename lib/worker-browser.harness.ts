// A fake DevTools connection for the worker browser's tests (lib/worker-browser*.test.ts): records what was sent, answers
// from a table, and emits events on demand.
import { vi } from "vitest";
import type { Cdp, CdpEvent } from "./worker-chromium";

export type Sent = { method: string; params: Record<string, unknown>; sessionId?: string };

export function fakeCdp(answers: Record<string, unknown> = {}) {
  const sent: Sent[] = [];
  const listeners = new Set<(e: CdpEvent) => void>();
  const closers: Array<() => void> = [];
  let closed = false;
  const cdp: Cdp & { emit: (e: CdpEvent) => void; sent: Sent[]; answers: Record<string, unknown> } = {
    sent,
    answers,
    get closed() {
      return closed;
    },
    send: vi.fn((method: string, params: Record<string, unknown> = {}, sessionId?: string) => {
      sent.push({ method, params, ...(sessionId ? { sessionId } : {}) });
      const answer = answers[method];
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve((typeof answer === "function" ? (answer as (p: unknown) => unknown)(params) : (answer ?? {})) as Record<string, unknown>);
    }),
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onClose(listener) {
      closers.push(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      closers.forEach((c) => c());
    },
    emit: (e) => listeners.forEach((l) => l(e)),
  };
  return cdp;
}

export const sentOf = (cdp: { sent: Sent[] }, method: string) => cdp.sent.filter((s) => s.method === method);
// Settles pending promise chains without a timer, so it works under fake timers too.
export async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
