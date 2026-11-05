// The mini-app wiring as main.cjs calls it (electron/mini-apps-setup.cjs) and the server-dependent
// wiring beside it (electron/server-wiring.cjs).
//
// Both are thin: they gather the pieces main has (the vault, the pane's ownership check, the
// board window, the running server) into the shape each module takes. The test holds them to
// that: the right modules get registered, and the server's url and token reach the ones that
// need them.

import { describe, expect, it, vi } from "vitest";
import { setupMiniApps } from "./mini-apps-setup.cjs";
import { setupServerWiring } from "./server-wiring.cjs";

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
const ipcMain = {
  handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
  on: (channel: string, fn: Handler) => handlers.set(channel, fn),
};

function goodVault() {
  return {
    confirm: vi.fn(() => Promise.resolve(true)),
    addBlanks: vi.fn(),
    valuesFor: vi.fn(() => Promise.resolve({ label: "you/repo", values: {}, missing: [] })),
    names: vi.fn(() => Promise.resolve({ label: "you/repo", secrets: [] })),
  };
}

const safeStorage = { isEncryptionAvailable: () => true };

describe("setupMiniApps", () => {
  it("registers the mini-app modules and the live-data bridge", () => {
    handlers.clear();
    const { account } = setupMiniApps({
      ipcMain,
      vault: goodVault(),
      dataDir: "/tmp",
      ownsPane: () => true,
      isBoard: () => true,
      supabaseReadLink: vi.fn(() => Promise.resolve(null)),
      getSafeStorage: () => safeStorage,
      getServer: () => ({ url: "http://127.0.0.1:1024" }),
      token: "tok",
    });
    expect(typeof account).toBe("function");
    expect(handlers.has("app-data:read")).toBe(true);
    expect(handlers.has("app-data:fetch")).toBe(true);
    expect(handlers.has("apps:push-secrets")).toBe(true);
    expect(handlers.has("live-data:read")).toBe(true);
  });

  it("hands the live-data bridge the server's url and the launch token", async () => {
    handlers.clear();
    const fetchImpl = vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("{}") }));
    setupMiniApps({
      ipcMain,
      vault: goodVault(),
      dataDir: "/tmp",
      ownsPane: () => true,
      isBoard: () => true,
      supabaseReadLink: vi.fn(() => Promise.resolve(null)),
      getSafeStorage: () => safeStorage,
      getServer: () => ({ url: "http://127.0.0.1:1024" }),
      token: "launch-token",
      fetch: fetchImpl,
    });
    // The handler exists and answers only the pane's own main frame.
    const handler = handlers.get("live-data:read")!;
    const main = { id: "pane" };
    const owned = { ...main, mainFrame: main };
    const res = (await handler({ sender: owned, senderFrame: owned.mainFrame }, "/api/infra/live")) as { ok: boolean };
    // The bridge asks the server with the launch token, on the path it was given.
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/infra/live");
    expect((init.headers as Record<string, string>)["x-weft-token"]).toBe("launch-token");
  });

  it("says the server isn't running instead of throwing when there is no server", async () => {
    handlers.clear();
    const fetchImpl = vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("{}") }));
    setupMiniApps({
      ipcMain,
      vault: goodVault(),
      dataDir: "/tmp",
      ownsPane: () => true,
      isBoard: () => true,
      supabaseReadLink: vi.fn(() => Promise.resolve(null)),
      getSafeStorage: () => safeStorage,
      getServer: () => null,
      token: "launch-token",
      fetch: fetchImpl,
    });
    const handler = handlers.get("live-data:read")!;
    const main = { id: "pane" };
    const owned = { ...main, mainFrame: main };
    const res = (await handler({ sender: owned, senderFrame: owned.mainFrame }, "/api/infra/live")) as { ok: boolean; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/isn't running/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("setupServerWiring", () => {
  it("registers the server supervisor's IPC and the splash IPC", () => {
    handlers.clear();
    const providers = setupServerWiring({
      ipcMain,
      dataDir: "/tmp",
      shell: { openPath: vi.fn() },
      app: { getVersion: () => "1.0.0" },
      timer: { finish: vi.fn(), mark: vi.fn() },
      boot: vi.fn(),
      startup: { show: vi.fn(), loadBoard: vi.fn(), fail: vi.fn() },
      getServer: () => ({ url: "http://127.0.0.1:1024" }),
      getBoardContents: () => ({ id: "board" }),
      getMenus: () => ({ refreshWaiting: vi.fn() }),
      keepWorking: null as unknown as (() => object),
      getHandleLink: () => vi.fn(),
      token: "tok",
      // The provider drawers reach for Electron's app, which isn't there in a test. The seam
      // lets the rest of the wiring be exercised; electron/providers.test.ts covers the drawers.
      setupProviders: () => ({ blastcpApi: { name: "blastcp" }, slackApi: { name: "slack" }, gooseApi: { name: "goose" } }),
    });
    // The provider APIs come back for main's control-server routes.
    expect(providers).toHaveProperty("blastcpApi");
    expect(providers).toHaveProperty("slackApi");
    expect(providers).toHaveProperty("gooseApi");
    // The splash IPC registered its channel.
    expect(handlers.has("startup:ready")).toBe(true);
  });

  it("gives the provider drawers the server's url and the launch token", () => {
    const seen: Array<{ server: () => { url: string; token: string } | null }> = [];
    setupServerWiring({
      ipcMain,
      dataDir: "/tmp",
      shell: { openPath: vi.fn() },
      app: { getVersion: () => "1.0.0" },
      timer: { finish: vi.fn(), mark: vi.fn() },
      boot: vi.fn(),
      startup: { show: vi.fn(), loadBoard: vi.fn(), fail: vi.fn() },
      getServer: () => ({ url: "http://127.0.0.1:1024" }),
      getBoardContents: () => ({ id: "board" }),
      getMenus: () => ({ refreshWaiting: vi.fn() }),
      keepWorking: null as unknown as (() => object),
      getHandleLink: () => vi.fn(),
      token: "launch-token",
      setupProviders: (opts: { server: () => { url: string; token: string } | null }) => {
        seen.push(opts);
        return { blastcpApi: {}, slackApi: {}, gooseApi: {} };
      },
    });
    // The drawers get the accessor, and it answers with the url and the token.
    expect(seen[0]?.server()).toEqual({ url: "http://127.0.0.1:1024", token: "launch-token" });
  });
});
