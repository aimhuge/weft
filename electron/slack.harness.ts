// The fake slack.com and the createSlack it drives, shared by electron/slack*.test.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { createSlack, TOKEN_FILE } from "./slack.cjs";

export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`w:${text}`),
  decryptString: (buf: Buffer) => buf.toString().slice(2),
};

export const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

export type Answer = { status?: number; body: unknown };
export type Init = { method: string; headers: Record<string, string>; body?: string };
export type Route = (url: URL, init: Init) => Answer;

// A fake slack.com: routes by method name (the last path segment), answers 404 otherwise. A route is
// either the answer's fields (team, url, channels…), a whole answer ({ status, body }), or a function of
// the request. Records each call's method, token and body.
export function fakeFetch(routes: Record<string, unknown>) {
  const calls: { method: string; token: string; body: Record<string, unknown> }[] = [];
  const fetch = vi.fn((url: string | URL, init: Init) => {
    const method = new URL(String(url)).pathname.replace("/api/", "");
    const token = (init.headers.Authorization ?? "").replace("Bearer ", "");
    // Slack's methods take a form body; a field that was JSON (blocks) comes back as a string.
    const body: Record<string, string> = {};
    for (const [key, value] of new URLSearchParams(init.body ?? "")) body[key] = value;
    calls.push({ method, token, body });
    const route = routes[method];
    const answer: Answer =
      typeof route === "function"
        ? (route as Route)(new URL(String(url)), init)
        : route === undefined
          ? { status: 404, body: { ok: false, error: "unknown_method" } }
          : "body" in (route as Answer)
            ? (route as Answer)
            : { body: { ok: true, ...(route as Record<string, unknown>) } };
    const status = answer.status ?? 200;
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(answer.body) });
  });
  return { fetch, calls };
}

// A websocket that never says anything, so the socket opens and waits.
export class QuietSocket {
  static made: QuietSocket[] = [];
  url: string;
  sent: string[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    QuietSocket.made.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.onclose?.();
  }
}

// The sockets made so far, and the newest one.
export const sockets = () => QuietSocket.made;
export const lastSocket = () => QuietSocket.made.at(-1) as QuietSocket;
// Forgets the sockets made so far, so a test starts with a clean list.
export const resetSockets = () => {
  QuietSocket.made = [];
};

export const API: Record<string, unknown> = {
  "auth.test": { team: "Acme", url: "https://acme.slack.com/", user: "weft" },
  "apps.connections.open": { url: "wss://example/socket" },
  "conversations.list": { channels: [{ id: "C1", name: "general", is_private: false, is_member: true }] },
  "chat.postMessage": { channel: "C1", ts: "1.2" },
  "conversations.join": { ok: true },
  "conversations.info": { channel: { id: "C1", is_private: false } },
};

// The slack it drives, with a fake fetch keyed by Slack method and a forward that records what arrives.
export function make(routes: Record<string, unknown> = API, over: { dataDir?: string; forward?: (inbound: unknown) => Promise<void>; safeStorage?: typeof safeStorage } = {}) {
  const dataDir = over.dataDir ?? tmp("weft-data-");
  const { fetch, calls } = fakeFetch(routes);
  const forward = vi.fn(over.forward ?? (() => Promise.resolve()));
  QuietSocket.made = [];
  const slack = createSlack({
    dataDir,
    safeStorage: over.safeStorage ?? safeStorage,
    fetch: fetch as unknown as typeof globalThis.fetch,
    WebSocketImpl: QuietSocket as unknown as typeof WebSocket,
    forward,
  });
  return { slack, dataDir, calls, forward };
}

export const tokenFile = (dataDir: string) => path.join(dataDir, TOKEN_FILE);
