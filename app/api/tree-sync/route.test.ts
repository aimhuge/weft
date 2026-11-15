// Synced folders through the API (app/api/tree-sync/route.ts): the guard, main and lib/mac-tree-sync are mocked;
// lib/mac-tree-sync.test.ts covers the peer's side itself.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
const gate = vi.hoisted(() => ({ elevatedDenied: null as Response | null }));
vi.mock("@/lib/guard", () => ({
  elevated: () => gate.elevatedDenied,
  fail: (err: Error, status = 400) => Response.json({ error: err.message }, { status }),
}));
const main = vi.hoisted(() => ({ shell: vi.fn<(route: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>>(() => Promise.resolve({ ok: true })) }));
vi.mock("@/lib/browser-shell", () => main);
const sync = vi.hoisted(() => ({
  open: vi.fn(() => Promise.resolve("OPEN")),
  opened: vi.fn(() => Promise.resolve()),
  receive: vi.fn(),
  out: vi.fn(() => Promise.resolve({ texts: ["a"], status: null })),
  close: vi.fn(),
  status: vi.fn(() => ({ kind: "connecting" })),
  lead: vi.fn(),
}));
vi.mock("@/lib/mac-tree-sync", () => ({ macSync: () => sync }));

const { POST } = await import("./route");

const T = { workerId: "w1", folder: "weft" };
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/tree-sync", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const json = async (body: unknown) => {
  const res = await post(body);
  return { status: res.status, body: (await res.json()) as unknown };
};

beforeEach(() => {
  vi.clearAllMocks();
  gate.elevatedDenied = null;
});

describe("POST /api/tree-sync", () => {
  it("answers the guard first", async () => {
    gate.elevatedDenied = new Response(null, { status: 403 });
    expect((await post({ op: "list" })).status).toBe(403);
  });

  it("lists main's folders", async () => {
    main.shell.mockResolvedValueOnce({ folders: [T] });
    expect(await json({ op: "list" })).toEqual({ status: 200, body: { folders: [T] } });
    expect(main.shell).toHaveBeenCalledWith("/tree-sync/list", {});
  });

  it("asks which worker and project when the body names none", async () => {
    for (const body of [{ op: "open" }, { op: "open", workerId: "w1" }, { op: "open", workerId: "", folder: "weft" }, { op: "open", workerId: "w1", folder: 3 }, "not json"]) {
      expect(await json(body)).toEqual({ status: 400, body: { error: "Which worker, and which project?" } });
    }
  });

  it("turns sync on through main, with a short worker name", async () => {
    await json({ op: "enable", ...T, workerName: "M".repeat(80) });
    expect(main.shell).toHaveBeenCalledWith("/tree-sync/enable", { ...T, workerName: "M".repeat(60) });
    await json({ op: "enable", ...T, workerName: 5 });
    expect(main.shell).toHaveBeenLastCalledWith("/tree-sync/enable", { ...T, workerName: undefined });
  });

  it("turns sync off: the peer stops, then main forgets it", async () => {
    expect((await json({ op: "disable", ...T })).body).toEqual({ ok: true });
    expect(sync.close).toHaveBeenCalledWith(T);
    expect(main.shell).toHaveBeenCalledWith("/tree-sync/disable", T);
  });

  it("opens and starts the peer", async () => {
    expect((await json({ op: "open", ...T })).body).toEqual({ open: "OPEN" });
    expect((await json({ op: "opened", ...T, workerName: "Mini" })).body).toEqual({ ok: true });
    expect(sync.opened).toHaveBeenCalledWith({ ...T, workerName: "Mini" });
  });

  it("hands in only strings, at most 500, and none when texts isn't a list", async () => {
    const texts = [...Array.from({ length: 600 }, (_, i) => `t${i}`), 4];
    await json({ op: "in", ...T, texts: [1, "a", ...texts] });
    expect((sync.receive.mock.calls[0] as unknown[])[1]).toHaveLength(500);
    expect(((sync.receive.mock.calls[0] as unknown[])[1] as string[])[0]).toBe("a");
    await json({ op: "in", ...T, texts: "a" });
    expect(sync.receive).toHaveBeenLastCalledWith(T, []);
  });

  it("answers out, close and status", async () => {
    expect((await json({ op: "out", ...T })).body).toEqual({ texts: ["a"], status: null });
    expect((await json({ op: "close", ...T })).body).toEqual({ ok: true });
    expect(sync.close).toHaveBeenCalledWith(T);
    expect((await json({ op: "status", ...T })).body).toEqual({ status: { kind: "connecting" } });
  });

  it("lets this Mac lead the next catch-up", async () => {
    expect((await json({ op: "lead", ...T })).body).toEqual({ ok: true });
    expect(sync.lead).toHaveBeenCalledWith(T);
  });

  it("refuses an unknown step", async () => {
    expect(await json({ op: "dance", ...T })).toEqual({ status: 400, body: { error: "No such step." } });
  });

  it("says why a step failed", async () => {
    sync.open.mockRejectedValueOnce(new Error("This Mac has no checkout of weft to sync with."));
    expect(await json({ op: "open", ...T })).toEqual({ status: 400, body: { error: "This Mac has no checkout of weft to sync with." } });
    sync.receive.mockImplementationOnce(() => {
      throw new Error("That folder isn't syncing right now.");
    });
    expect((await json({ op: "in", ...T, texts: [] })).status).toBe(400);
  });
});
