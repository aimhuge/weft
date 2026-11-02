// lib/app-cloud.ts against a fake account client + blob store. The mocks live in lib/app-cloud.harness.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountMock, blobStoreMock, cloudSyncMock, db, inserted, localApps, miniAppStoreMock, resetDb,
} from "./app-cloud.harness";
import type { MiniApp } from "./mini-apps";

// Set WEFT_DATA before the first import of lib/store.ts so DATA_DIR (captured at module import)
// points at our test dir for the whole run.
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "weft-app-cloud-"));
process.env.WEFT_DATA = DATA;
process.env.HOME = DATA;

vi.mock("./account", () => accountMock());
vi.mock("./cloud-sync", () => cloudSyncMock());
vi.mock("./blob-store", () => blobStoreMock());
vi.mock("./mini-app-store", () => miniAppStoreMock());

const { pushApp, dropCloudApp, pullApps, syncAppsSoon } = await import("./app-cloud");

let envData = "";
let envHome = "";

beforeEach(() => {
  envData = process.env.WEFT_DATA ?? "";
  envHome = process.env.HOME ?? "";
  process.env.WEFT_DATA = DATA;
  process.env.HOME = DATA;
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });
  resetDb();
});
afterEach(() => {
  process.env.WEFT_DATA = envData;
  process.env.HOME = envHome;
  fs.rmSync(DATA, { recursive: true, force: true });
});

function appAt(rel: string, name: string, kind: "file" | "folder"): MiniApp {
  const dir = path.join(DATA, "apps", rel);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "index.html");
  fs.writeFileSync(filePath, "<h1>hi</h1>");
  if (kind === "folder") fs.writeFileSync(path.join(dir, "weft-app.json"), JSON.stringify({ name: "📈 Growth" }));
  return { id: rel, name, url: `file://${filePath}`, addedAt: 0 };
}

describe("pushApp", () => {
  it("is a no-op when accounts aren't set up, signed out, or in no workspace", async () => {
    db.configured = false; await pushApp({ id: "x", name: "X", url: "https://x.test", addedAt: 0 }); expect(db.writes).toEqual([]);
    db.configured = true; db.user = null; await pushApp({ id: "x", name: "X", url: "https://x.test", addedAt: 0 }); expect(db.writes).toEqual([]);
    db.user = "u1"; db.org = null; await pushApp({ id: "x", name: "X", url: "https://x.test", addedAt: 0 }); expect(db.writes).toEqual([]);
  });

  it("inserts a site row with kind 'site' and a null page", async () => {
    await pushApp({ id: "s1", name: "Site", url: "https://x.test", addedAt: 0 });
    expect(db.writes.find((w) => w.op === "insert")!.row).toMatchObject({ app_id: "s1", org_id: "o1", name: "Site", url: "https://x.test", kind: "site", page: null, manifest: null, position: 0 });
    expect(db.uploadedPaths).toEqual([]);
  });

  it("uses the app's index in listApps() as position on insert and update", async () => {
    localApps.push({ id: "a", name: "A", url: "https://a.test", addedAt: 0 }, { id: "s1", name: "S1", url: "https://s1.test", addedAt: 0 }, { id: "b", name: "B", url: "https://b.test", addedAt: 0 });
    await pushApp({ id: "s1", name: "Site", url: "https://x.test", addedAt: 0 });
    expect(db.writes.find((w) => w.op === "insert")!.row).toMatchObject({ app_id: "s1", position: 1 });
    db.existing.set("s1", { app_id: "s1", org_id: "o1", name: "Old", url: "https://x.test", kind: "site", page: null, manifest: null, position: 0, deleted: false });
    await pushApp({ id: "s1", name: "Site", url: "https://x.test", addedAt: 0 });
    const update = db.writes.find((w) => w.op === "update");
    expect(update!.row).toMatchObject({ position: 1 });
    expect(update!.filters).toEqual({ app_id: "s1" });
  });

  it("skips a file: URL that resolvePage refuses (outside home)", async () => {
    const filePath = path.join(os.tmpdir(), `outside-${Date.now()}.html`);
    fs.writeFileSync(filePath, "<h1>hi</h1>");
    try { await pushApp({ id: "x", name: "X", url: `file://${filePath}`, addedAt: 0 }); expect(db.writes).toEqual([]); }
    finally { fs.rmSync(filePath, { force: true }); }
  });

  it("skips a file: URL whose file is gone", async () => {
    await pushApp({ id: "x", name: "X", url: `file://${path.join(DATA, "apps", "x", "index.html")}`, addedAt: 0 });
    expect(db.writes).toEqual([]);
  });

  it("skips a file whose sha can't be read", async () => {
    db.sha = "";
    await pushApp(appAt("f1", "File", "file"));
    expect(db.writes).toEqual([]);
  });

  it("uploads a file app's page only when its sha differs from the existing row, and updates the row", async () => {
    const app = appAt("f1", "File", "file");
    db.existing.set("f1", { app_id: "f1", org_id: "o1", name: "Old", url: app.url, kind: "file", page: "blob:sha256:" + "0".repeat(64), manifest: null, position: 0, deleted: false });
    await pushApp(app);
    expect(db.uploadedPaths).toEqual([path.join(DATA, "apps", "f1", "index.html")]);
    const update = db.writes.find((w) => w.op === "update");
    expect(update!.row).toMatchObject({ org_id: "o1", name: "File", kind: "file", page: "blob:sha256:" + "a".repeat(64), manifest: null, deleted: false });
    expect(update!.row.app_id).toBeUndefined();
    expect(update!.filters).toEqual({ app_id: "f1" });
  });

  it("does not re-upload a file whose sha already matches the row's page", async () => {
    const app = appAt("f1", "File", "file");
    db.existing.set("f1", { app_id: "f1", org_id: "o1", name: "File", url: app.url, kind: "file", page: "blob:sha256:" + "a".repeat(64), manifest: null, position: 0, deleted: false });
    await pushApp(app);
    expect(db.uploadedPaths).toEqual([]);
  });

  it("uploads and inserts a folder app with its parsed manifest", async () => {
    await pushApp(appAt("folder1", "Growth", "folder"));
    const insert = db.writes.find((w) => w.op === "insert");
    expect(insert!.row).toMatchObject({ app_id: "folder1", kind: "folder", page: "blob:sha256:" + "a".repeat(64), manifest: { name: "📈 Growth" } });
    // deleted isn't in the insert grant; sending it would make Postgres refuse the whole row.
    expect(insert!.row).not.toHaveProperty("deleted");
  });

  it("a folder with a broken or non-object weft-app.json falls back to a plain file", async () => {
    const bad = appAt("folder2", "Growth", "folder");
    fs.writeFileSync(path.join(DATA, "apps", "folder2", "weft-app.json"), "{not json");
    await pushApp(bad);
    expect(db.writes.find((w) => w.op === "insert")!.row).toMatchObject({ kind: "file", manifest: null });
    const arr = appAt("folder3", "Growth", "folder");
    fs.writeFileSync(path.join(DATA, "apps", "folder3", "weft-app.json"), "[]");
    await pushApp(arr);
    expect(db.writes.filter((w) => w.op === "insert").pop()!.row).toMatchObject({ kind: "file", manifest: null });
  });

  it("never sends a worker card's page with a manifest, even with a weft-app.json beside it", async () => {
    await pushApp(appAt("worker-0123456789abcdef", "W", "folder"));
    expect(db.writes.find((w) => w.op === "insert")!.row).toMatchObject({ app_id: "worker-0123456789abcdef", kind: "file", manifest: null });
  });

  it("skips a URL whose scheme is neither http(s) nor file", async () => {
    await pushApp({ id: "x", name: "X", url: "weft://x", addedAt: 0 });
    expect(db.writes).toEqual([]);
  });

  it("a page outside ~/.weft/apps/ is uploaded as kind 'file'; url keeps the #hash, page ref does not", async () => {
    const filePath = path.join(DATA, "show", "x.html");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "<h1>show</h1>");
    await pushApp({ id: "show1", name: "Show", url: `file://${filePath}#step-2`, addedAt: 0 });
    const insert = db.writes.find((w) => w.op === "insert");
    expect(insert!.row).toMatchObject({ kind: "file", page: "blob:sha256:" + "a".repeat(64), manifest: null });
    expect(insert!.row.url).toBe(`file://${filePath}#step-2`);
  });

  it("saving an app again after its row was tombstoned sets deleted false via update", async () => {
    const app = appAt("f1", "File", "file");
    db.existing.set("f1", { app_id: "f1", org_id: "o1", name: "Old", url: app.url, kind: "file", page: "blob:sha256:" + "a".repeat(64), manifest: null, position: 0, deleted: true });
    await pushApp(app);
    expect(db.writes.filter((w) => w.op === "insert")).toEqual([]);
    const update = db.writes.find((w) => w.op === "update");
    expect(update!.row).toMatchObject({ deleted: false });
    expect(db.existing.get("f1")!.deleted).toBe(false);
  });

  it("skips the write when the upload yields no ref", async () => {
    db.uploadReturnsNull = true;
    const app = appAt("f1", "File", "file");
    db.existing.set("f1", { app_id: "f1", org_id: "o1", name: "File", url: app.url, kind: "file", page: "blob:sha256:" + "0".repeat(64), manifest: null, position: 0, deleted: false });
    await pushApp(app);
    expect(db.writes.filter((w) => w.op === "insert" || w.op === "update")).toEqual([]);
  });

  it("swallows a Supabase error so the local save still wins", async () => {
    db.writeError = { message: "rls" };
    await expect(pushApp({ id: "s", name: "S", url: "https://s.test", addedAt: 0 })).resolves.toBeUndefined();
  });
});

describe("dropCloudApp", () => {
  it("is a no-op when accounts aren't set up or signed out or no workspace", async () => {
    db.configured = false; await dropCloudApp("a"); expect(db.writes.filter((w) => w.op === "update")).toEqual([]);
    db.configured = true; db.user = null; await dropCloudApp("a"); expect(db.writes.filter((w) => w.op === "update")).toEqual([]);
    db.user = "u1"; db.org = null; await dropCloudApp("a"); expect(db.writes.filter((w) => w.op === "update")).toEqual([]);
  });

  it("tombstones the row by app_id", async () => {
    await dropCloudApp("a1");
    const upd = db.writes.find((w) => w.op === "update");
    expect(upd!.row).toEqual({ deleted: true });
    expect(upd!.filters).toEqual({ app_id: "a1" });
  });

  it("swallows a Supabase error", async () => {
    db.writeError = { message: "rls" };
    await expect(dropCloudApp("a1")).resolves.toBeUndefined();
  });
});

describe("pullApps", () => {
  it("is a no-op when accounts aren't set up, signed out, or no workspace", async () => {
    db.configured = false; await pullApps();
    db.configured = true; db.user = null; await pullApps();
    db.user = "u1"; db.org = null; await pullApps();
    expect(db.queries.filter((q) => q.table === "cloud_mini_apps")).toEqual([]);
  });

  it("pushes the local apps prod has no row for, and leaves a tombstoned one alone", async () => {
    localApps.push({ id: "new", name: "New", url: "https://n.test", addedAt: 0 }, { id: "gone", name: "Gone", url: "https://g.test", addedAt: 0 });
    db.listRows = [{ app_id: "gone", org_id: "o1", name: "Gone", url: "https://g.test", kind: "site", page: null, manifest: null, position: 1, deleted: true }];
    await pullApps();
    const inserts = db.writes.filter((w) => w.op === "insert");
    expect(inserts.map((w) => w.row.app_id)).toEqual(["new"]);
    expect(inserted).toEqual([]);
  });

  it("warns and carries on when pushing a missing app fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    localApps.push({ id: "new", name: "New", url: "https://n.test", addedAt: 0 });
    db.writeError = { message: "permission denied" };
    await pullApps();
    expect(warn).toHaveBeenCalledWith("Mini app push to prod failed: permission denied");
    warn.mockRestore();
  });

  it("skips deleted rows and rows this Mac already has", async () => {
    db.listRows = [
      { app_id: "gone", org_id: "o1", name: "Gone", url: "https://g.test", kind: "site", page: null, manifest: null, position: 0, deleted: true },
      { app_id: "have", org_id: "o1", name: "Have", url: "https://h.test", kind: "site", page: null, manifest: null, position: 1, deleted: false },
    ];
    localApps.push({ id: "have", name: "Have", url: "https://h.test", addedAt: 0 });
    await pullApps();
    expect(inserted).toEqual([]);
  });


  it("inserts a site row at its position", async () => {
    db.listRows = [{ app_id: "a", org_id: "o1", name: "A", url: "https://a.test", kind: "site", page: null, manifest: null, position: 0, deleted: false }];
    await pullApps();
    expect(inserted).toEqual([{ id: "a", app: { name: "A", url: "https://a.test", addedAt: expect.any(Number) as number }, at: 0 }]);
  });

  it("writes a file row's index.html from fetchBlob and inserts a pathToFileURL url at its position", async () => {
    const cacheFile = path.join(DATA, "blob-cache", "x".repeat(64));
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, "<h1>fetched</h1>");
    db.fetched = [{ ref: "o1/" + "x".repeat(64), file: cacheFile }];
    db.sha = "x".repeat(64);
    db.listRows = [{ app_id: "f1", org_id: "o1", name: "F1", url: "old", kind: "file", page: "blob:sha256:" + "x".repeat(64), manifest: null, position: 0, deleted: false }];
    await pullApps();
    expect(fs.readFileSync(path.join(DATA, "apps", "f1", "index.html"), "utf8")).toBe("<h1>fetched</h1>");
    expect(inserted[0]!.app.url).toBe(pathToFileURL(path.join(DATA, "apps", "f1", "index.html")).href);
  });

  it("writes a folder row's weft-app.json from the manifest alongside the page", async () => {
    const cacheFile = path.join(DATA, "blob-cache", "y".repeat(64));
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, "<h1>page</h1>");
    db.fetched = [{ ref: "o1/" + "y".repeat(64), file: cacheFile }];
    db.sha = "y".repeat(64);
    db.listRows = [{ app_id: "folder1", org_id: "o1", name: "Folder", url: "old", kind: "folder", page: "blob:sha256:" + "y".repeat(64), manifest: { name: "📈 Growth", reads: {} }, position: 0, deleted: false }];
    await pullApps();
    expect(fs.readFileSync(path.join(DATA, "apps", "folder1", "weft-app.json"), "utf8")).toBe(JSON.stringify({ name: "📈 Growth", reads: {} }, null, 2));
    expect(inserted[0]!.app.url).toBe(pathToFileURL(path.join(DATA, "apps", "folder1", "index.html")).href);
  });

  it("writes no weft-app.json for a worker card's page, whatever its row says", async () => {
    const cacheFile = path.join(DATA, "blob-cache", "y".repeat(64));
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, "<h1>page</h1>");
    db.fetched = [{ ref: "o1/" + "y".repeat(64), file: cacheFile }];
    db.sha = "y".repeat(64);
    db.listRows = [{ app_id: "worker-0123456789abcdef", org_id: "o1", name: "W", url: "old", kind: "folder", page: "blob:sha256:" + "y".repeat(64), manifest: { name: "x" }, position: 0, deleted: false }];
    await pullApps();
    expect(fs.existsSync(path.join(DATA, "apps", "worker-0123456789abcdef", "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(DATA, "apps", "worker-0123456789abcdef", "weft-app.json"))).toBe(false);
  });

  it("skips a file/folder row when fetchBlob returns null or the page is missing", async () => {
    db.sha = "z".repeat(64);
    db.listRows = [
      { app_id: "missing", org_id: "o1", name: "M", url: "x", kind: "file", page: "blob:sha256:" + "z".repeat(64), manifest: null, position: 0, deleted: false },
      { app_id: "broken", org_id: "o1", name: "B", url: "x", kind: "file", page: null, manifest: null, position: 0, deleted: false },
    ];
    await pullApps();
    expect(inserted).toEqual([]);
  });

  it("throws on a list error so the caller's catch can see it (callers swallow it)", async () => {
    db.listError = { message: "boom" };
    await expect(pullApps()).rejects.toThrow("boom");
  });

  it("swallows an error in one row so the others still come down", async () => {
    const goodCache = path.join(DATA, "blob-cache", "g".repeat(64));
    fs.mkdirSync(path.dirname(goodCache), { recursive: true });
    fs.writeFileSync(goodCache, "<h1>good</h1>");
    db.sha = "g".repeat(64);
    // Two rows: one's blob path's parent is gone (copyFileSync throws ENOENT), the other is good.
    db.listRows = [
      { app_id: "broken", org_id: "o1", name: "B", url: "x", kind: "file", page: "blob:sha256:" + "0".repeat(64), manifest: null, position: 0, deleted: false },
      { app_id: "good", org_id: "o1", name: "G", url: "x", kind: "file", page: "blob:sha256:" + "g".repeat(64), manifest: null, position: 1, deleted: false },
    ];
    db.fetched = [{ ref: "o1/" + "0".repeat(64), file: path.join(DATA, "blob-cache", "missing", "src") }, { ref: "o1/" + "g".repeat(64), file: goodCache }];
    await pullApps();
    expect(inserted.map((i) => i.id)).toEqual(["good"]);
  });
});

describe("syncAppsSoon", () => {
  it("runs a pull, swallows errors, and dedupes concurrent calls", async () => {
    db.listRows = [{ app_id: "s", org_id: "o1", name: "S", url: "https://s.test", kind: "site", page: null, manifest: null, position: 0, deleted: false }];
    syncAppsSoon();
    syncAppsSoon();
    await new Promise((r) => setTimeout(r, 0));
    expect(inserted.length).toBe(1);
  });

  it("throttles a second call within 5 minutes to no-op", async () => {
    db.listRows = [{ app_id: "s", org_id: "o1", name: "S", url: "https://s.test", kind: "site", page: null, manifest: null, position: 0, deleted: false }];
    syncAppsSoon();
    await new Promise((r) => setTimeout(r, 0));
    db.listRows = [{ app_id: "second", org_id: "o1", name: "Second", url: "https://second.test", kind: "site", page: null, manifest: null, position: 0, deleted: false }];
    syncAppsSoon();
    await new Promise((r) => setTimeout(r, 0));
    expect(inserted.map((i) => i.id)).toEqual(["s"]);
  });

  it("dedupes a second call while a pull is still in flight (not just throttled)", async () => {
    // Hang the auth check so the first pull stays in flight; the second call's in-flight guard fires.
    db.hangGetSession = true;
    syncAppsSoon();
    // Reset lastPullAt so the second call passes the throttle and reaches the in-flight check.
    const g = globalThis as unknown as { __weftAppCloud?: { lastPullAt: number; inFlight: Promise<void> | null } };
    g.__weftAppCloud!.lastPullAt = 0;
    const beforeQueries = db.queries.length;
    syncAppsSoon();
    expect(db.queries.length).toBe(beforeQueries);
    db.hangGetSession = false;
    await new Promise((r) => setTimeout(r, 0));
  });
});
