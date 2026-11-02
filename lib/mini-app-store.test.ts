import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppShareMemo } from "./mini-apps";

// The apps sidebar's store, against a real file in a temp dir (WEFT_DATA), never ~/.weft.

let dir: string;
const g = globalThis as unknown as { __weftState?: unknown };

async function load() {
  vi.resetModules();
  delete g.__weftState;
  const store = await import("./store");
  const apps = await import("./mini-app-store");
  return { store, apps };
}

const appsFile = () => path.join(dir, "apps.json");
const readApps = () => (JSON.parse(fs.readFileSync(appsFile(), "utf8")) as { apps: unknown[] }).apps;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-apps-"));
  process.env.WEFT_DATA = dir;
});
afterEach(() => {
  delete g.__weftState;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("listApps", () => {
  it("returns an empty list when there is no file", async () => {
    const { apps } = await load();
    expect(apps.listApps()).toEqual([]);
  });

  it("returns an empty list when the file is broken or not a { apps: [] } shape", async () => {
    fs.writeFileSync(appsFile(), "{not json");
    const { apps } = await load();
    expect(apps.listApps()).toEqual([]);

    fs.writeFileSync(appsFile(), JSON.stringify({ apps: "nope" }));
    const loaded = await load();
    expect(loaded.apps.listApps()).toEqual([]);
  });
});

describe("saveApp", () => {
  it("writes a new app, deriving the name from the URL when no name is given", async () => {
    const { apps } = await load();
    const saved = apps.saveApp("https://example.com/foo");
    expect(saved.name).toBe("example.com");
    expect(saved.url).toBe("https://example.com/foo");
    expect(readApps()).toEqual([saved]);
  });

  it("uses the given name when one is provided", async () => {
    const { apps } = await load();
    const saved = apps.saveApp("https://example.com", "My App");
    expect(saved.name).toBe("My App");
    expect(readApps()).toEqual([saved]);
  });

  it("keeps the page an app was saved from, when it isn't the app's own address", async () => {
    const { apps } = await load();
    const saved = apps.saveApp("file:///tmp/index.html", "Page", "blob:sha256:abc");
    expect(saved.source).toBe("blob:sha256:abc");
    expect(apps.saveApp("https://example.com").source).toBeUndefined();
  });

  it("returns the existing app unchanged when saving a URL that is already saved without a name", async () => {
    const { apps } = await load();
    const first = apps.saveApp("https://example.com", "First");
    const again = apps.saveApp("https://example.com");
    expect(again).toEqual(first);
    expect(readApps()).toEqual([first]);
  });

  it("renames the existing app when saving a URL that is already saved with a new name", async () => {
    const { apps } = await load();
    const first = apps.saveApp("https://example.com", "First");
    const again = apps.saveApp("https://example.com", "Renamed");
    expect(again.id).toBe(first.id);
    expect(again.name).toBe("Renamed");
    expect(readApps()).toEqual([again]);
  });

  it("refuses a non-http(s)/file URL", async () => {
    const { apps } = await load();
    expect(() => apps.saveApp("about:blank")).toThrow("An app is a web page or a local file (http, https or file).");
    expect(() => apps.saveApp(42)).toThrow("An app is a web page or a local file (http, https or file).");
    expect(fs.existsSync(appsFile())).toBe(false);
  });
});

describe("updateApp", () => {
  it("renames the app", async () => {
    const { apps } = await load();
    const saved = apps.saveApp("https://example.com", "Old");
    const updated = apps.updateApp(saved.id, { name: "New" });
    expect(updated.name).toBe("New");
    expect(readApps()).toEqual([updated]);
  });

  it("moves the app to the given index", async () => {
    const { apps } = await load();
    const a = apps.saveApp("https://a.test", "A");
    const b = apps.saveApp("https://b.test", "B");
    const c = apps.saveApp("https://c.test", "C");
    apps.updateApp(c.id, { to: 0 });
    expect((readApps() as { id: string }[]).map((x) => x.id)).toEqual([c.id, a.id, b.id]);
  });

  it("refuses an empty name and a non-integer 'to'", async () => {
    const { apps } = await load();
    const saved = apps.saveApp("https://example.com", "Old");
    expect(() => apps.updateApp(saved.id, { name: "  " })).toThrow("An app needs a name.");
    expect(() => apps.updateApp(saved.id, { to: 1.5 })).toThrow("to is a position.");
    expect(() => apps.updateApp(saved.id, { to: "1" })).toThrow("to is a position.");
  });

  it("throws on an unknown id", async () => {
    const { apps } = await load();
    expect(() => apps.updateApp("nope", { name: "x" })).toThrow("No such app.");
    expect(() => apps.updateApp("nope", { to: 0 })).toThrow("No such app.");
  });
});

describe("removeApp", () => {
  it("takes the app out of the list", async () => {
    const { apps } = await load();
    const a = apps.saveApp("https://a.test", "A");
    const b = apps.saveApp("https://b.test", "B");
    apps.removeApp(a.id);
    expect(readApps()).toEqual([b]);
  });

  it("throws on an unknown id", async () => {
    const { apps } = await load();
    expect(() => apps.removeApp("nope")).toThrow("No such app.");
  });
});

describe("rememberAppShare", () => {
  it("writes the share memo once, and skips a memo that's the same as what's already there", async () => {
    const { apps } = await load();
    const saved = apps.saveApp("https://example.com", "App");
    apps.rememberAppShare(saved.id, { id: "s1", mode: "public", hasPassword: false });
    expect((readApps()[0] as { share: unknown }).share).toEqual({ id: "s1", mode: "public", hasPassword: false });

    const before = fs.readFileSync(appsFile(), "utf8");
    apps.rememberAppShare(saved.id, { id: "s1", mode: "public", hasPassword: false });
    const after = fs.readFileSync(appsFile(), "utf8");
    expect(after).toBe(before);

    // A changed memo writes; here the mode flips and hasPassword becomes true.
    apps.rememberAppShare(saved.id, { id: "s1", mode: "password", hasPassword: true });
    expect((readApps()[0] as { share: unknown }).share).toEqual({ id: "s1", mode: "password", hasPassword: true });
  });

  it("leaves the other apps as they were", async () => {
    const { apps } = await load();
    const one = apps.saveApp("https://one.example.com", "One");
    const two = apps.saveApp("https://two.example.com", "Two");
    apps.rememberAppShare(two.id, { id: "s2", mode: "public", hasPassword: false });
    expect(readApps()).toEqual([one, { ...two, share: { id: "s2", mode: "public", hasPassword: false } }]);
  });

  it("ignores an unknown app id (the app may have been removed before the share answer landed)", async () => {
    const { apps } = await load();
    const saved = apps.saveApp("https://example.com", "App");
    apps.removeApp(saved.id);
    apps.rememberAppShare(saved.id, { id: "s1", mode: "public", hasPassword: false });
    expect(readApps()).toEqual([]);
  });

  it("remembers the public url, owner, slug, and orgId on the share", async () => {
    const { apps } = await load();
    const saved = apps.saveApp("https://example.com", "App");
    const memo: AppShareMemo = {
      id: "s1", mode: "public", hasPassword: false,
      url: "https://weft.zip/@alice/apps/growth", owner: "user", slug: "growth", orgId: null,
    };
    apps.rememberAppShare(saved.id, memo);
    expect((readApps()[0] as { share: unknown }).share).toEqual({
      id: "s1", mode: "public", hasPassword: false,
      url: "https://weft.zip/@alice/apps/growth", owner: "user", slug: "growth", orgId: null,
    });
  });

  it("rewrites the memo when the owner or slug changes", async () => {
    const { apps } = await load();
    const saved = apps.saveApp("https://example.com", "App");
    apps.rememberAppShare(saved.id, { id: "s1", mode: "public", hasPassword: false, owner: "user", slug: "growth" } as AppShareMemo);
    apps.rememberAppShare(saved.id, { id: "s1", mode: "public", hasPassword: false, owner: "org", slug: "growth", orgId: "o2" } as AppShareMemo);
    expect((readApps()[0] as { share: { owner: string; orgId: string | null } }).share).toEqual(expect.objectContaining({ owner: "org", orgId: "o2" }));
  });
});

describe("insertAppAt", () => {
  it("inserts the app at the requested index, clamping past the end to the size and negatives to 0", async () => {
    const { apps } = await load();
    const a = apps.saveApp("https://a.test", "A");
    const b = apps.saveApp("https://b.test", "B");
    apps.insertAppAt("c", { name: "C", url: "https://c.test", addedAt: 0 }, 0);
    apps.insertAppAt("d", { name: "D", url: "https://d.test", addedAt: 0 }, 99);
    apps.insertAppAt("e", { name: "E", url: "https://e.test", addedAt: 0 }, -5);
    expect((readApps() as { id: string }[]).map((x) => x.id)).toEqual(["e", "c", a.id, b.id, "d"]);
  });

  it("is a no-op when the id is already in the list", async () => {
    const { apps } = await load();
    const a = apps.saveApp("https://a.test", "A");
    expect(apps.insertAppAt(a.id, { name: "Other", url: "https://other.test", addedAt: 0 }, 0)).toBeUndefined();
    expect(readApps()).toEqual([a]);
  });

  it("truncates a fractional position to an integer", async () => {
    const { apps } = await load();
    const a = apps.saveApp("https://a.test", "A");
    const b = apps.saveApp("https://b.test", "B");
    apps.insertAppAt("c", { name: "C", url: "https://c.test", addedAt: 0 }, 1.9);
    expect((readApps() as { id: string }[]).map((x) => x.id)).toEqual([a.id, "c", b.id]);
  });
});
