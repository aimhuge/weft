import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/webhooks (list, add), /api/webhooks/[id] (change, delete) and its /relay. lib/webhooks and lib/webhook-forward
// are mocked; the guard and the folder check are real, so folders are ones that exist.

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/webhooks", () => ({
  listWebhooks: vi.fn(() => [{ id: "h1", name: "stripe" }]),
  addWebhook: vi.fn(() => ({ hook: { id: "h1", name: "stripe" }, existed: false })),
  updateWebhook: vi.fn(() => ({ id: "h1", registered: true })),
  getWebhook: vi.fn(() => ({ id: "h1" })),
  removeWebhook: vi.fn(),
}));
vi.mock("@/lib/webhook-forward", () => ({
  relaySignedIn: vi.fn(() => Promise.resolve(true)),
  createRelay: vi.fn(() => Promise.resolve({ id: "h1", url: "https://weft.zip/h/r1" })),
  removeRelay: vi.fn(() => Promise.resolve({ id: "h1" })),
}));

const workerLists = vi.hoisted(() => vi.fn(() => Promise.resolve({ crons: [], webhooks: [] as { id: string; folder: string }[] })));
vi.mock("@/lib/worker-lists-read", async (load) => ({ ...(await load<typeof import("@/lib/worker-lists-read")>()), workerLists }));

const reg = await import("@/lib/webhooks");
const fwd = await import("@/lib/webhook-forward");
const list = await import("./webhooks/route");
const one = await import("./webhooks/[id]/route");
const relay = await import("./webhooks/[id]/relay/route");

const URL = "http://localhost:3457/api/webhooks";
const READ = { host: "localhost:3457" };
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };
const FOLDER = os.tmpdir();
const ctx = { params: Promise.resolve({ id: "h1" }) };
const send = (method: string, body?: unknown, headers: Record<string, string> = WRITE) => new Request(URL, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => vi.clearAllMocks());

describe("GET /api/webhooks", () => {
  it("lists all webhooks, or those of the folders asked for, and says if the relay is signed in", async () => {
    const res = await list.GET(new Request(URL, { headers: READ }));
    expect(await res.json()).toEqual({ hooks: [{ id: "h1", name: "stripe" }], signedIn: true });
    expect(reg.listWebhooks).toHaveBeenLastCalledWith(undefined);
    await list.GET(new Request(`${URL}?folder=/a&folder=/b`, { headers: READ }));
    expect(reg.listWebhooks).toHaveBeenLastCalledWith(["/a", "/b"]);
  });

  it("counts signed out when the check fails, and refuses other hosts", async () => {
    vi.mocked(fwd.relaySignedIn).mockRejectedValueOnce(new Error("offline"));
    expect(((await (await list.GET(new Request(URL, { headers: READ }))).json()) as { signedIn: boolean }).signedIn).toBe(false);
    expect((await list.GET(new Request("http://evil.test/api/webhooks", { headers: { host: "evil.test" } }))).status).toBe(403);
    vi.mocked(reg.listWebhooks).mockImplementationOnce(() => {
      throw new Error("broken");
    });
    const res = await list.GET(new Request(URL, { headers: READ }));
    expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([400, "broken"]);
  });
});

describe("GET /api/webhooks: a worker's", () => {
  it("adds a worker's published webhooks for the folders asked for, or all", async () => {
    const hooks = [{ id: "worker:w1:h2", folder: "worker://w1/app" }, { id: "worker:w1:h3", folder: "worker://w1/other" }];
    workerLists.mockResolvedValue({ crons: [], webhooks: hooks });
    type Listed = { hooks: unknown[] };
    const forApp = (await (await list.GET(new Request(`${URL}?folder=worker://w1/app`, { headers: READ }))).json()) as Listed;
    expect(forApp.hooks).toEqual([{ id: "h1", name: "stripe" }, hooks[0]]);
    const all = (await (await list.GET(new Request(URL, { headers: READ }))).json()) as Listed;
    expect(all.hooks).toHaveLength(3);
    workerLists.mockResolvedValue({ crons: [], webhooks: [] });
  });

  it("refuses to change or delete a worker's webhook from this Mac", async () => {
    const wctx = { params: Promise.resolve({ id: "worker:w1:h2" }) };
    expect((await one.PATCH(send("PATCH", { registered: true }), wctx)).status).toBe(400);
    expect((await one.DELETE(send("DELETE"), wctx)).status).toBe(400);
    expect(reg.updateWebhook).not.toHaveBeenCalled();
    expect(reg.removeWebhook).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks", () => {
  it("adds a webhook in an existing folder", async () => {
    const body = { folder: FOLDER, name: "stripe", target: "/s", events: ["e"], hint: "h", secret: "K" };
    expect(await (await list.POST(send("POST", body))).json()).toEqual({ hook: { id: "h1", name: "stripe" }, existed: false });
    expect(reg.addWebhook).toHaveBeenCalledWith({ ...body, folder: FOLDER });
  });

  it("refuses a missing header, a missing folder and a registry error", async () => {
    expect((await list.POST(send("POST", { folder: FOLDER }, READ))).status).toBe(403);
    const nofolder = await list.POST(send("POST", { folder: "/no/such/folder", name: "x", target: "/x" }));
    expect(nofolder.status).toBe(400);
    vi.mocked(reg.addWebhook).mockImplementationOnce(() => {
      throw new Error("A webhook needs a name, e.g. stripe.");
    });
    const res = await list.POST(send("POST", { folder: FOLDER }));
    expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([400, "A webhook needs a name, e.g. stripe."]);
  });
});

describe("PATCH and DELETE /api/webhooks/[id]", () => {
  it("changes a webhook", async () => {
    expect(await (await one.PATCH(send("PATCH", { registered: true }), ctx)).json()).toEqual({ hook: { id: "h1", registered: true } });
    expect(reg.updateWebhook).toHaveBeenCalledWith("h1", { registered: true });
    expect((await one.PATCH(send("PATCH", {}, READ), ctx)).status).toBe(403);
    vi.mocked(reg.updateWebhook).mockImplementationOnce(() => {
      throw new Error("That webhook is gone.");
    });
    expect((await one.PATCH(send("PATCH", {}), ctx)).status).toBe(400);
  });

  it("takes the relay down first when it has one, then removes the webhook", async () => {
    expect(await (await one.DELETE(send("DELETE"), ctx)).json()).toEqual({ ok: true });
    expect(fwd.removeRelay).not.toHaveBeenCalled();
    expect(reg.removeWebhook).toHaveBeenCalledWith("h1");
    vi.mocked(reg.getWebhook).mockReturnValueOnce({ id: "h1", relayId: "r1" } as never);
    await one.DELETE(send("DELETE"), ctx);
    expect(fwd.removeRelay).toHaveBeenCalledWith("h1");
  });

  it("keeps the webhook when its relay can't come down, and refuses a missing header", async () => {
    vi.mocked(reg.getWebhook).mockReturnValueOnce({ id: "h1", relayId: "r1" } as never);
    vi.mocked(fwd.removeRelay).mockRejectedValueOnce(new Error("offline"));
    const res = await one.DELETE(send("DELETE"), ctx);
    expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([400, "offline"]);
    expect(reg.removeWebhook).not.toHaveBeenCalled();
    expect((await one.DELETE(send("DELETE", undefined, READ), ctx)).status).toBe(403);
  });
});

describe("POST and DELETE /api/webhooks/[id]/relay", () => {
  it("makes and removes the public url", async () => {
    expect(await (await relay.POST(send("POST"), ctx)).json()).toEqual({ hook: { id: "h1", url: "https://weft.zip/h/r1" } });
    expect(fwd.createRelay).toHaveBeenCalledWith("h1");
    expect(await (await relay.DELETE(send("DELETE"), ctx)).json()).toEqual({ hook: { id: "h1" } });
    expect(fwd.removeRelay).toHaveBeenCalledWith("h1");
  });

  it("says why it couldn't, and refuses a missing header", async () => {
    vi.mocked(fwd.createRelay).mockRejectedValueOnce(new Error("Sign in to your Weft account first."));
    const res = await relay.POST(send("POST"), ctx);
    expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([400, "Sign in to your Weft account first."]);
    vi.mocked(fwd.removeRelay).mockRejectedValueOnce(new Error("offline"));
    expect((await relay.DELETE(send("DELETE"), ctx)).status).toBe(400);
    expect((await relay.POST(send("POST", undefined, READ), ctx)).status).toBe(403);
    expect((await relay.DELETE(send("DELETE", undefined, READ), ctx)).status).toBe(403);
  });
});
