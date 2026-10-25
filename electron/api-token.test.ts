import { describe, expect, it, vi } from "vitest";
import { attachApiToken, attachPaneAttachments, attachTokens } from "./api-token.cjs";

type Listener = (details: { method: string; requestHeaders: Record<string, string> }, cb: (r: unknown) => void) => void;
function fakeSession() {
  const calls: { filter: { urls: string[] }; listener: Listener }[] = [];
  return { calls, webRequest: { onBeforeSendHeaders: (filter: { urls: string[] }, listener: Listener) => calls.push({ filter, listener }) } };
}
function hook(s: { calls: { filter: { urls: string[] }; listener: Listener }[] }) {
  const c = s.calls[0];
  if (!c) throw new Error("no hook attached");
  return c;
}
function send(listener: Listener, method: string): unknown {
  let out: unknown;
  listener({ method, requestHeaders: { accept: "*/*" } }, (r) => (out = r));
  return out;
}

describe("api token", () => {
  it("puts the launch token on every board request to the server", () => {
    const s = fakeSession();
    attachApiToken(s, "http://127.0.0.1:1024/", "secret");
    expect(hook(s).filter.urls).toEqual(["http://127.0.0.1:1024/*"]);
    expect(send(hook(s).listener, "POST")).toEqual({ requestHeaders: { accept: "*/*", "x-weft-token": "secret" } });
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
