import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MiniApp } from "@/lib/mini-apps";

// GET/POST/PATCH/DELETE /api/apps (lib/mini-app-store.ts, lib/guard.ts): the store is mocked so
// the route's guard and error mapping are the things under test.

const store = vi.hoisted(() => ({
  listApps: vi.fn((): MiniApp[] => []),
  saveApp: vi.fn(() => ({ id: "saved", name: "Saved", url: "https://saved.test", addedAt: 0 })),
  updateApp: vi.fn(() => ({ id: "u", name: "Updated", url: "https://u.test", addedAt: 0 })),
  removeApp: vi.fn(),
}));
vi.mock("@/lib/mini-app-store", () => store);

const dropAppShare = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@/lib/app-share", () => ({ dropAppShare }));

// `after` from next/server needs a request context; the route tests run outside one, so we run the
// callback synchronously (or push it into a queue the test can drain).
const afterMock = vi.hoisted(() => ({ run: (cb: () => unknown) => cb() }));
vi.mock("next/server", () => ({ after: (cb: () => unknown) => afterMock.run(cb) }));

const cloudMock = vi.hoisted(() => ({
  pushApp: vi.fn(() => Promise.resolve()),
  dropCloudApp: vi.fn(() => Promise.resolve()),
  syncAppsSoon: vi.fn(),
}));
vi.mock("@/lib/app-cloud", () => cloudMock);

const fromWorker = vi.hoisted(() => ({ saveWorkerPageApp: vi.fn(() => Promise.resolve({ id: "w", name: "Report", url: "file:///x/index.html", addedAt: 0 })) }));
vi.mock("@/lib/mini-app-worker", () => fromWorker);

const route = await import("./apps/route");
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };
const make = (method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown, headers: Record<string, string> = WRITE) =>
  new Request("http://localhost:3457/api/apps", { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  store.listApps.mockReset().mockReturnValue([]);
  store.saveApp.mockReset().mockReturnValue({ id: "saved", name: "Saved", url: "https://saved.test", addedAt: 0 });
  store.updateApp.mockReset().mockReturnValue({ id: "u", name: "Updated", url: "https://u.test", addedAt: 0 });
  store.removeApp.mockReset();
  dropAppShare.mockReset().mockResolvedValue(undefined);
  cloudMock.pushApp.mockReset().mockResolvedValue(undefined);
  cloudMock.dropCloudApp.mockReset().mockResolvedValue(undefined);
  cloudMock.syncAppsSoon.mockReset();
  afterMock.run = (cb) => cb();
});

describe("GET /apps", () => {
  it("returns the saved apps", async () => {
    store.listApps.mockReturnValueOnce([{ id: "a", name: "A", url: "https://a.test", addedAt: 1 }]);
    const res = route.GET(make("GET"));
    expect(await res.json()).toEqual({ apps: [{ id: "a", name: "A", url: "https://a.test", addedAt: 1 }] });
  });

  it("kicks off a throttled background pull so a Mac that lacks an app eventually gets it", () => {
    route.GET(make("GET"));
    expect(cloudMock.syncAppsSoon).toHaveBeenCalledOnce();
  });

  it("does not need the x-weft-token header (read-only)", () => {
    const res = route.GET(make("GET", undefined, { host: "localhost:3457" }));
    expect(res.status).toBe(200);
  });

  it("refuses a non-local host", () => {
    const res = route.GET(make("GET", undefined, { host: "evil.test", "x-weft-token": "1" }));
    expect(res.status).toBe(403);
  });
});

describe("POST /apps", () => {
  it("saves a page and returns the app, pushing it to prod after the response", async () => {
    const res = await route.POST(make("POST", { url: "https://example.com" }));
    expect(store.saveApp).toHaveBeenCalledWith("https://example.com", undefined);
    expect(cloudMock.pushApp).toHaveBeenCalledWith({ id: "saved", name: "Saved", url: "https://saved.test", addedAt: 0 });
    expect(await res.json()).toEqual({ app: { id: "saved", name: "Saved", url: "https://saved.test", addedAt: 0 } });
  });

  it("brings a worker card's page home before saving it", async () => {
    const page = `blob:sha256:${"b".repeat(64)}`;
    const res = await route.POST(make("POST", { url: page, name: "Report" }));
    expect(fromWorker.saveWorkerPageApp).toHaveBeenCalledWith(page, "Report");
    expect(store.saveApp).not.toHaveBeenCalled();
    expect(((await res.json()) as { app: MiniApp }).app.id).toBe("w");
  });

  it("passes a name through to the store", async () => {
    await route.POST(make("POST", { url: "https://example.com", name: "My App" }));
    expect(store.saveApp).toHaveBeenCalledWith("https://example.com", "My App");
  });

  it("turns a thrown error into a 400 and doesn't push", async () => {
    store.saveApp.mockImplementationOnce(() => {
      throw new Error("An app is a web page or a local file (http, https or file).");
    });
    const res = await route.POST(make("POST", { url: "about:blank" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "An app is a web page or a local file (http, https or file)." });
    expect(cloudMock.pushApp).not.toHaveBeenCalled();
  });

  it("refuses the call without the write header", async () => {
    const res = await route.POST(make("POST", { url: "https://x.test" }, { host: "localhost:3457", "content-type": "application/json" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(store.saveApp).not.toHaveBeenCalled();
  });
});

describe("PATCH /apps", () => {
  it("renames and moves the app, pushing the new shape to prod", async () => {
    await route.PATCH(make("PATCH", { id: "a", name: "New", to: 0 }));
    expect(store.updateApp).toHaveBeenCalledWith("a", { name: "New", to: 0 });
    expect(cloudMock.pushApp).toHaveBeenCalledWith({ id: "u", name: "Updated", url: "https://u.test", addedAt: 0 });
    expect(await (await route.PATCH(make("PATCH", { id: "a" }))).json()).toEqual({ app: { id: "u", name: "Updated", url: "https://u.test", addedAt: 0 } });
  });

  it("turns a thrown error into a 400 and doesn't push", async () => {
    store.updateApp.mockImplementationOnce(() => {
      throw new Error("No such app.");
    });
    const res = await route.PATCH(make("PATCH", { id: "nope" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No such app." });
    expect(cloudMock.pushApp).not.toHaveBeenCalled();
  });

  it("refuses the call without the write header", async () => {
    const res = await route.PATCH(make("PATCH", { id: "a" }, { host: "localhost:3457", "content-type": "application/json" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(store.updateApp).not.toHaveBeenCalled();
  });
});

describe("DELETE /apps", () => {
  it("removes the app and replies ok, tombstoning the row on prod", async () => {
    const res = await route.DELETE(make("DELETE", { id: "a" }));
    expect(store.removeApp).toHaveBeenCalledWith("a");
    expect(cloudMock.dropCloudApp).toHaveBeenCalledWith("a");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("drops the app's share link, looking the app up by id first", async () => {
    const app = { id: "a", name: "A", url: "https://a.test", addedAt: 0, share: { id: "s1", mode: "public" as const, hasPassword: false } };
    store.listApps.mockReturnValueOnce([app]);
    const res = await route.DELETE(make("DELETE", { id: "a" }));
    expect(dropAppShare).toHaveBeenCalledWith(app);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("still answers ok when dropAppShare rejects (the app is gone either way)", async () => {
    const app = { id: "a", name: "A", url: "https://a.test", addedAt: 0, share: { id: "s1", mode: "public" as const, hasPassword: false } };
    store.listApps.mockReturnValueOnce([app]);
    dropAppShare.mockRejectedValueOnce(new Error("supabase down"));
    const res = await route.DELETE(make("DELETE", { id: "a" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("turns a thrown error into a 400 and doesn't tombstone", async () => {
    store.removeApp.mockImplementationOnce(() => {
      throw new Error("No such app.");
    });
    const res = await route.DELETE(make("DELETE", { id: "nope" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No such app." });
    expect(cloudMock.dropCloudApp).not.toHaveBeenCalled();
  });

  it("refuses the call without the write header", async () => {
    const res = await route.DELETE(make("DELETE", { id: "a" }, { host: "localhost:3457", "content-type": "application/json" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(store.removeApp).not.toHaveBeenCalled();
  });
});
