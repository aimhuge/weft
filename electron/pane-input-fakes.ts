// The fakes the pane-input tests share: a CDP session that answers per method, a page, a clock the
// test moves by hand, and the builder that wires them into an input module.

import { vi } from "vitest";
import { createPaneInput } from "./pane-input.cjs";

export type Params = Record<string, unknown>;

// A CDP session that answers per method. Handlers get the params and answer whatever the caller
// wants to hand back; the default is an empty result, so a test only says what it cares about.
export function fakeCdp(handlers: Record<string, (params: Params) => unknown> = {}) {
  const send = vi.fn((_wc: unknown, method: string, params: Params) => {
    const handler = handlers[method];
    if (!handler) return Promise.resolve({ result: { value: undefined } });
    return Promise.resolve(handler(params));
  });
  return { send };
}

// A page: a webContents the input module asks about.
export function fakePage({ loading = false, url = "http://localhost:3000/", title = "Test page" } = {}) {
  return {
    isLoading: () => loading,
    getURL: () => url,
    getTitle: () => title,
  };
}

// A clock the test moves by hand.
export function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

export const point = (over: Record<string, unknown> = {}) => ({ result: { value: { x: 10, y: 20, ...over } } });

// An input module over a fake CDP, with the page functions' answers given per function.
export function make(
  handlers: Record<string, (params: Params) => unknown>,
  { wait = () => Promise.resolve(), now = () => 0 }: { wait?: (ms: number) => Promise<unknown>; now?: () => number } = {},
) {
  const cdp = fakeCdp(handlers);
  const wc = fakePage();
  const input = createPaneInput({ cdp, wait, now });
  return { cdp, wc, input };
}
