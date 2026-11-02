// One card's page in the worker's browser, shaped like the Electron webContents the pane's CDP modules drive
// (electron/pane-cdp.cjs, electron/pane-input.cjs), so a worker card's click, snapshot and wait run the very code a
// desktop card's do (docs/architecture/worker-browser.md). The debugger is the page's flattened CDP session.
import type { Cdp, CdpEvent } from "./worker-chromium";

type Listener = (...args: unknown[]) => void;

export interface PageContents {
  debugger: {
    attach(): void;
    isAttached(): boolean;
    sendCommand(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
    on(event: "message" | "detach", listener: Listener): void;
  };
  on(event: string, listener: Listener): void;
  isDestroyed(): boolean;
  isLoading(): boolean;
  getURL(): string;
  getTitle(): string;
}

export interface BrowserPage {
  key: string;
  sessionId: string;
  targetId: string;
  wc: PageContents;
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  // Page events only, as the page's session sees them.
  on(listener: (method: string, params: Record<string, unknown>) => void): () => void;
  // Reads the URL and title fresh, for the routes that answer with them.
  refresh(): Promise<void>;
}

type Frame = { id?: string; parentId?: string; url?: string };

export function browserPage(cdp: Cdp, key: string, targetId: string, sessionId: string): BrowserPage {
  const state = { url: "", title: "", loading: false, gone: false };
  const listeners: Record<string, Listener[]> = { message: [], detach: [], "did-navigate": [] };
  const fire = (name: string, ...args: unknown[]) => listeners[name]?.forEach((l) => l(...args));
  const pageEvents = new Set<(method: string, params: Record<string, unknown>) => void>();
  const send = (method: string, params: Record<string, unknown> = {}) => cdp.send(method, params, sessionId);

  // The main frame's id is the target's.
  const main = (frameId: unknown) => frameId === targetId;
  const onEvent = (e: CdpEvent) => {
    if (e.method === "Target.detachedFromTarget" && e.params.sessionId === sessionId) {
      state.gone = true;
      fire("detach");
      return;
    }
    if (e.sessionId !== sessionId) return;
    const { method, params } = e;
    if (method === "Page.frameNavigated") {
      const frame = params.frame as Frame;
      if (!frame.parentId) {
        state.url = frame.url ?? state.url;
        fire("did-navigate");
      }
    } else if (method === "Page.navigatedWithinDocument" && main(params.frameId)) state.url = String(params.url);
    else if (method === "Page.frameStartedLoading" && main(params.frameId)) state.loading = true;
    else if ((method === "Page.frameStoppedLoading" && main(params.frameId)) || method === "Page.loadEventFired") state.loading = false;
    fire("message", {}, method, params);
    pageEvents.forEach((l) => l(method, params));
  };
  cdp.on(onEvent);
  cdp.onClose(() => {
    state.gone = true;
    fire("detach");
  });

  const wc: PageContents = {
    debugger: {
      attach: () => {},
      isAttached: () => !state.gone && !cdp.closed,
      sendCommand: send,
      on: (event, listener) => void listeners[event]?.push(listener),
    },
    on: (event, listener) => void listeners[event]?.push(listener),
    isDestroyed: () => state.gone || cdp.closed,
    isLoading: () => state.loading,
    getURL: () => state.url,
    getTitle: () => state.title,
  };

  return {
    key,
    sessionId,
    targetId,
    wc,
    send,
    on(listener) {
      pageEvents.add(listener);
      return () => pageEvents.delete(listener);
    },
    async refresh() {
      const r = (await send("Runtime.evaluate", { expression: "({ url: location.href, title: document.title })", returnByValue: true }).catch(() => ({}))) as {
        result?: { value?: { url?: string; title?: string } };
      };
      const value = r.result?.value;
      if (!value) return;
      state.url = value.url ?? state.url;
      state.title = value.title ?? "";
    },
  };
}
