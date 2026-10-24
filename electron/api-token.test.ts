import { describe, expect, it, vi } from "vitest";
import { attachApiToken, attachPaneAttachments, attachTokens } from "./api-token.cjs";

type Listener = (details: { method: string; requestHeaders: Record<string, string> }, cb: (r: unknown) => void) => void;
function fakeSession() {
  const calls: { filter: { urls: string[] }; listener: Listener }[] = [];
  return { calls, webRequest: { onBeforeSendHeaders: (filter: { urls: string[] }, listener: Listener) => calls.push({ filter, listener }) } };
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
    expect(s.calls[0].filter.urls).toEqual(["http://127.0.0.1:1024/*"]);
    expect(send(s.calls[0].listener, "POST")).toEqual({ requestHeaders: { accept: "*/*", "x-weft-token": "secret" } });
  });

  it("gives the pane only the read value, only on attachment GETs", () => {
    const s = fakeSession();
    attachPaneAttachments(s, "http://127.0.0.1:1024");
    expect(s.calls[0].filter.urls).toEqual(["http://127.0.0.1:1024/api/attachments/*"]);
    expect(send(s.calls[0].listener, "GET")).toEqual({ requestHeaders: { accept: "*/*", "x-weft-token": "1" } });
    expect(send(s.calls[0].listener, "HEAD")).toEqual({ requestHeaders: { accept: "*/*", "x-weft-token": "1" } });
    expect(send(s.calls[0].listener, "POST")).toEqual({});
  });

  it("attaches both once the server is up", () => {
    const board = fakeSession();
    const pane = fakeSession();
    const fromPartition = vi.fn(() => pane);
    attachTokens({ defaultSession: board, fromPartition }, "http://127.0.0.1:1024", "secret");
    expect(fromPartition).toHaveBeenCalledWith("persist:threadboard-browser");
    expect(board.calls[0].filter.urls).toEqual(["http://127.0.0.1:1024/*"]);
    expect(pane.calls[0].filter.urls).toEqual(["http://127.0.0.1:1024/api/attachments/*"]);
  });
});
