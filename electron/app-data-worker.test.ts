// An app saved from a worker card's page (lib/mini-app-worker.ts, apps/worker-<sha16>/) gets none of the pane's bridge:
// no data reads, fetch, env or secrets even beside a weft-app.json, no live data, and no author secrets pushed for it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { appFolderFromUrl } from "./app-data.cjs";
import { isWorkerAppPage, isWorkerAppPath, WORKER_APP_REFUSED } from "./app-data-frame.cjs";
import { createAppSecretsPush } from "./app-secrets-push.cjs";
import { registerLiveData } from "./live-data.cjs";
import { makeDataDir, makeVault } from "./app-data-test-helpers";

// A data dir with apps/<slug>/index.html and a weft-app.json beside it, as a data app has.
function appIn(slug: string) {
  const dataDir = makeDataDir();
  const folder = path.join(dataDir, "apps", slug);
  fs.mkdirSync(path.join(folder, "nested"), { recursive: true });
  fs.writeFileSync(path.join(folder, "index.html"), "<html></html>");
  fs.writeFileSync(path.join(folder, "nested", "index.html"), "<html></html>");
  fs.writeFileSync(path.join(folder, "weft-app.json"), JSON.stringify({ name: "x", env: "production", reads: {}, secrets: { K: { hosts: ["api.x.com"] } } }));
  return { dataDir, folder, url: `file://${path.join(folder, "index.html")}` };
}

describe("isWorkerAppPath / isWorkerAppPage", () => {
  it("knows a worker app's folder and anything in it, by the real path", () => {
    const { dataDir, folder, url } = appIn("worker-0123456789abcdef");
    expect(isWorkerAppPath(dataDir, fs.realpathSync(folder))).toBe(true);
    expect(isWorkerAppPage(dataDir, url)).toBe(true);
    expect(isWorkerAppPage(dataDir, `file://${path.join(folder, "nested", "index.html")}`)).toBe(true);
    // A link elsewhere in apps/ to a worker app's folder is still that folder.
    fs.symlinkSync(folder, path.join(dataDir, "apps", "growth"));
    expect(isWorkerAppPage(dataDir, `file://${path.join(dataDir, "apps", "growth", "index.html")}`)).toBe(true);
  });

  it("leaves every other page alone", () => {
    const { dataDir, url } = appIn("growth");
    expect(isWorkerAppPage(dataDir, url)).toBe(false);
    expect(isWorkerAppPage(dataDir, "https://example.com/worker-1")).toBe(false);
    expect(isWorkerAppPage(dataDir, "file:///nowhere/worker-1/index.html")).toBe(false);
    expect(isWorkerAppPage(dataDir, undefined)).toBe(false);
    expect(isWorkerAppPath(dataDir, path.join(dataDir, "apps"))).toBe(false);
    expect(isWorkerAppPath(path.join(os.tmpdir(), "no-such-weft"), "/x")).toBe(false);
  });
});

describe("the bridge on a worker app", () => {
  it("refuses data reads, fetch, env and secrets even with a weft-app.json", () => {
    const { dataDir, url } = appIn("worker-0123456789abcdef");
    expect(() => appFolderFromUrl(dataDir, url)).toThrow(WORKER_APP_REFUSED);
    const growth = appIn("growth");
    expect(appFolderFromUrl(growth.dataDir, growth.url).folder).toContain("growth");
  });

  it("refuses live data to a worker app's page, and answers any other", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const ipcMain = { handle: (ch: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(ch, fn) };
    const liveData = vi.fn(() => Promise.resolve({ ok: true }));
    const worker = appIn("worker-0123456789abcdef");
    registerLiveData(ipcMain, { liveData, owns: () => true, dataDir: worker.dataDir });
    const handler = handlers.get("live-data:read")!;
    const event = (url: string) => {
      const frame = { url };
      return { sender: { mainFrame: frame }, senderFrame: frame };
    };
    await expect(handler(event(worker.url), "/api/infra/live")).rejects.toThrow(WORKER_APP_REFUSED);
    expect(liveData).not.toHaveBeenCalled();
    await handler(event(`file://${path.join(worker.dataDir, "show", "report.html")}`), "/api/infra/live");
    expect(liveData).toHaveBeenCalledOnce();
  });

  it("won't push author secrets for a worker app", async () => {
    const { dataDir, url } = appIn("worker-0123456789abcdef");
    fs.writeFileSync(path.join(dataDir, "apps.json"), JSON.stringify({ apps: [{ id: "worker-0123456789abcdef", name: "W", url, share: { id: "s" }, addedAt: 1 }] }));
    const fetchImpl = vi.fn();
    const confirm = vi.fn(() => Promise.resolve(true));
    const handle = createAppSecretsPush({ dataDir, vault: makeVault({ values: { K: "v" } }), account: () => ({ "weft-auth": { access_token: "t" } }), confirm, fetch: fetchImpl });
    expect(await handle.push("worker-0123456789abcdef")).toEqual({ error: WORKER_APP_REFUSED });
    expect(confirm).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
