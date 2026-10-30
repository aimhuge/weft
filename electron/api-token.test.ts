import { describe, expect, it, vi } from "vitest";
import { attachApiToken, attachPaneAttachments, attachTokens } from "./api-token.cjs";

interface Details {
  method: string;
  url?: string;
  resourceType?: string;
  initiatorOrigin?: string;
  frame?: { parent: unknown } | null;
  requestHeaders: Record<string, string>;
}
type Listener = (details: Details, cb: (r: unknown) => void) => void;
function fakeSession() {
  const calls: { filter: { urls: string[] }; listener: Listener }[] = [];
  return { calls, webRequest: { onBeforeSendHeaders: (filter: { urls: string[] }, listener: Listener) => calls.push({ filter, listener }) } };
}
function hook(s: { calls: { filter: { urls: string[] }; listener: Listener }[] }) {
  const c = s.calls[0];
  if (!c) throw new Error("no hook attached");
  return c;
}
function send(listener: Listener, method: string, details: Partial<Details> = {}): unknown {
  let out: unknown;
  listener({ method, url: "http://127.0.0.1:1024/api/cards", requestHeaders: { accept: "*/*" }, ...details }, (r) => (out = r));
  return out;
}
const SHA = "a".repeat(64);
const PAGE = `http://127.0.0.1:1024/api/worker-board/page/${SHA}`;
const child = { parent: { parent: null } };

describe("api token", () => {
  it("puts the launch token on every board request to the server", () => {
    const s = fakeSession();
    attachApiToken(s, "http://127.0.0.1:1024/", "secret");
    expect(hook(s).filter.urls).toEqual(["http://127.0.0.1:1024/*"]);
    expect(send(hook(s).listener, "POST")).toEqual({ requestHeaders: { accept: "*/*", "x-weft-token": "secret" } });
  });

  it("gives the board's own frame the token, whatever it asks for", () => {
    const s = fakeSession();
    attachApiToken(s, "http://127.0.0.1:1024", "secret");
    const own = { requestHeaders: { accept: "*/*", "x-weft-token": "secret" } };
    expect(send(hook(s).listener, "GET", { resourceType: "mainFrame", frame: null })).toEqual(own);
    expect(send(hook(s).listener, "POST", { resourceType: "xhr", frame: { parent: null } })).toEqual(own);
    expect(send(hook(s).listener, "GET", { resourceType: "xhr", initiatorOrigin: "http://127.0.0.1:1024", frame: null })).toEqual(own);
  });

  it.each([
    ["a frame's navigation", { resourceType: "subFrame" }],
    ["a frame's fetch", { resourceType: "xhr", frame: child }],
    ["a sandboxed frame whose frame object is gone", { resourceType: "image", initiatorOrigin: "null", frame: null }],
  ])("never gives %s the token, and drops what it sent", (_name, details) => {
    const s = fakeSession();
    attachApiToken(s, "http://127.0.0.1:1024", "secret");
    const sent = { accept: "*/*", "x-weft-token": "1" };
    expect(send(hook(s).listener, "GET", { ...details, requestHeaders: sent })).toEqual({ requestHeaders: { accept: "*/*" } });
  });

  it("counts a frame it can no longer read as a frame", () => {
    const s = fakeSession();
    attachApiToken(s, "http://127.0.0.1:1024", "secret");
    const gone = {
      get parent(): unknown {
        throw new Error("Render frame was disposed");
      },
    };
    expect(send(hook(s).listener, "GET", { resourceType: "xhr", frame: gone })).toEqual({ requestHeaders: { accept: "*/*" } });
  });

  it("gives a frame only the read value, only to load a worker's page", () => {
    const s = fakeSession();
    attachApiToken(s, "http://127.0.0.1:1024", "secret");
    const frame = { resourceType: "subFrame" };
    expect(send(hook(s).listener, "GET", { ...frame, url: PAGE })).toEqual({ requestHeaders: { accept: "*/*", "x-weft-token": "1" } });
    expect(send(hook(s).listener, "GET", { ...frame, url: `${PAGE}?x=1` })).toEqual({ requestHeaders: { accept: "*/*", "x-weft-token": "1" } });
    expect(send(hook(s).listener, "POST", { ...frame, url: PAGE })).toEqual({ requestHeaders: { accept: "*/*" } });
    expect(send(hook(s).listener, "GET", { ...frame, url: `${PAGE}/../../../settings` })).toEqual({ requestHeaders: { accept: "*/*" } });
  });

  it("gives the pane only the read value, only on attachment GETs, by either loopback name", () => {
    const s = fakeSession();
    attachPaneAttachments(s, "http://127.0.0.1:1024");
    expect(hook(s).filter.urls).toEqual(["http://127.0.0.1:1024/api/attachments/*", "http://localhost:1024/api/attachments/*"]);
    expect(send(hook(s).listener, "GET")).toEqual({ requestHeaders: { accept: "*/*", "x-weft-token": "1" } });
    expect(send(hook(s).listener, "HEAD")).toEqual({ requestHeaders: { accept: "*/*", "x-weft-token": "1" } });
    expect(send(hook(s).listener, "POST")).toEqual({});
  });

  it("attaches both once the server is up", () => {
    const board = fakeSession();
    const pane = fakeSession();
    const fromPartition = vi.fn(() => pane);
    attachTokens({ defaultSession: board, fromPartition }, "http://127.0.0.1:1024", "secret");
    expect(fromPartition).toHaveBeenCalledWith("persist:threadboard-browser");
    expect(hook(board).filter.urls).toEqual(["http://127.0.0.1:1024/*"]);
    expect(hook(pane).filter.urls).toEqual(["http://127.0.0.1:1024/api/attachments/*", "http://localhost:1024/api/attachments/*"]);
  });
});
