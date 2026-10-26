// The live-data bridge (electron/live-data.cjs): the narrow door a `file:` page uses to read a
// JSON snapshot from Weft's own server without ever holding the launch token.
//
// The tests cover the three things that make it safe to point a page at it: the path is checked
// against an allowlist (a page can't use it to reach anywhere else), the request carries the
// launch token from main and the page never sees it, and the IPC handler answers only the pane's
// own main frame.

import { describe, expect, it, vi } from "vitest";
import { ALLOWED, cleanPath, createLiveData, registerLiveData } from "./live-data.cjs";

function jsonRes(body: unknown, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  };
}

describe("cleanPath", () => {
  it("accepts the paths the bridge allows", () => {
    for (const p of ALLOWED) expect(cleanPath(p)).toBe(p);
  });

  it("rejects anything that isn't a path on Weft's own server", () => {
    expect(() => cleanPath("http://evil.example.com/steal")).toThrow(/own server/);
    expect(() => cleanPath("//evil.example.com/steal")).toThrow(/own server/);
    expect(() => cleanPath("/api/infra/live/../secrets")).toThrow(/own server/);
    expect(() => cleanPath("api/infra/live")).toThrow(/own server/);
  });

  it("rejects a path it wasn't given", () => {
    expect(() => cleanPath("/api/threads")).toThrow(/live read/);
    expect(() => cleanPath("/api/infra/other")).toThrow(/live read/);
  });

  it("rejects a missing or non-string path", () => {
    expect(() => cleanPath("")).toThrow(/required/);
    expect(() => cleanPath(undefined)).toThrow(/required/);
    expect(() => cleanPath(42)).toThrow(/required/);
  });
});

describe("createLiveData", () => {
  it("fetches the path on Weft's own server and returns the JSON", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonRes({ at: "2026-10-27T00:00:00.000Z", live: { database_bytes: 1 } })));
    const liveData = createLiveData({ serverUrl: "http://127.0.0.1:1024", token: "tok", fetch: fetchImpl as never });

    const res = await liveData("/api/infra/live");
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ at: "2026-10-27T00:00:00.000Z" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("http://127.0.0.1:1024/api/infra/live");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["x-weft-token"]).toBe("tok");
  });

  it("reads the server url and the token fresh on each call", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonRes({ ok: 1 })));
    let url = "";
    let token = "";
    const liveData = createLiveData({
      serverUrl: () => url,
      token: () => token,
      fetch: fetchImpl as never,
    });

    // The server may not be up when main wires this: the first call says so, the second works.
    expect(await liveData("/api/infra/live")).toEqual({ ok: false, error: "Weft's server isn't running." });

    url = "http://127.0.0.1:1024";
    token = "tok-2";
    const res = await liveData("/api/infra/live");
    expect(res.ok).toBe(true);
    const [called, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(called.toString()).toBe("http://127.0.0.1:1024/api/infra/live");
    expect((init.headers as Record<string, string>)["x-weft-token"]).toBe("tok-2");
  });

  it("answers with the server's error rather than throwing", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonRes({ error: "Forbidden" }, 403)));
    const liveData = createLiveData({ serverUrl: "http://127.0.0.1:1024", token: "tok", fetch: fetchImpl as never });
    const res = await liveData("/api/infra/live");
    expect(res).toEqual({ ok: false, error: "Forbidden", status: 403 });
  });

  it("says so when the server answers something that isn't JSON", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonRes("<html>not json</html>", 200)));
    const liveData = createLiveData({ serverUrl: "http://127.0.0.1:1024", token: "tok", fetch: fetchImpl as never });
    const res = await liveData("/api/infra/live");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/isn't JSON/);
  });

  it("refuses a path it wasn't given, before any fetch", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonRes({})));
    const liveData = createLiveData({ serverUrl: "http://127.0.0.1:1024", token: "tok", fetch: fetchImpl as never });
    await expect(liveData("/api/threads")).rejects.toThrow(/live read/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("registerLiveData", () => {
  function fakeIpc() {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    return { handlers, ipcMain: { handle: (ch: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(ch, fn) } };
  }

  function frameEvent(sender: unknown, senderFrame: unknown) {
    return { sender, senderFrame };
  }

  // A sender that owns a main frame: the two are the same object, as Electron reports them.
  function ownedSender(id: string) {
    const main = { id };
    return { ...main, mainFrame: main };
  }

  it("answers the pane's own main frame", async () => {
    const { handlers, ipcMain } = fakeIpc();
    const liveData = vi.fn(() => Promise.resolve({ ok: true, data: { hello: 1 } }));
    registerLiveData(ipcMain, { liveData, owns: () => true });

    const handler = handlers.get("live-data:read")!;
    const main = ownedSender("pane");
    const res = (await handler(frameEvent(main, main.mainFrame), "/api/infra/live")) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(liveData).toHaveBeenCalledWith("/api/infra/live");
  });

  it("refuses a frame the pane doesn't own", async () => {
    const { handlers, ipcMain } = fakeIpc();
    const liveData = vi.fn(() => Promise.resolve({ ok: true }));
    registerLiveData(ipcMain, { liveData, owns: () => false });

    const handler = handlers.get("live-data:read")!;
    const main = ownedSender("other");
    await expect(handler(frameEvent(main, main.mainFrame), "/api/infra/live")).rejects.toThrow(/main frame/);
    expect(liveData).not.toHaveBeenCalled();
  });

  it("refuses a subframe of the pane's own page", async () => {
    const { handlers, ipcMain } = fakeIpc();
    const liveData = vi.fn(() => Promise.resolve({ ok: true }));
    registerLiveData(ipcMain, { liveData, owns: () => true });

    const handler = handlers.get("live-data:read")!;
    const main = ownedSender("pane");
    const iframe = { id: "iframe" };
    // event.senderFrame is the iframe, but event.sender.mainFrame is the page: not the same object.
    await expect(handler(frameEvent(main, iframe), "/api/infra/live")).rejects.toThrow(/main frame/);
    expect(liveData).not.toHaveBeenCalled();
  });
});
