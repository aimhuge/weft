// /api/cards/:id/dev: GET is dev.status, and POST's actions (start, restart, stop, open, rerun, log) the dev.* verbs,
// mounted for this Mac's own cards.
import { beforeEach, describe, expect, it, vi } from "vitest";

const verbs = vi.hoisted(() => ({ calls: [] as unknown[][], answer: (): Promise<unknown> => Promise.resolve({}) }));
const getCard = vi.hoisted(() => vi.fn((id: string) => (id === "c1" ? { id, cwd: "/p" } : undefined)));
vi.mock("@/lib/host-api", async () => ({
  runVerb: (...args: unknown[]) => {
    verbs.calls.push(args);
    return verbs.answer();
  },
  hostFail: (await import("@/lib/host-api/http")).hostFail,
  requireCard: (await import("@/lib/host-api/types")).requireCard,
}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/guard", async () => ({ ...(await vi.importActual<object>("@/lib/guard")), guard: () => null }));
vi.mock("@/lib/store", () => ({ getCard }));

const { GET, POST } = await import("./cards/[id]/dev/route");
const post = (id: string, body: unknown) => POST(new Request(`http://localhost/api/cards/${id}/dev`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  verbs.calls = [];
});

describe("POST /cards/:id/dev", () => {
  it("open answers the card's private address", async () => {
    verbs.answer = () => Promise.resolve({ address: "https://weft.zip/t/t1" });
    const res = await post("c1", { action: "open" });
    expect(await res.json()).toEqual({ address: "https://weft.zip/t/t1" });
    expect(verbs.calls).toEqual([["dev.open", { id: "c1" }]]);
  });

  it("open says why it couldn't", async () => {
    verbs.answer = () => Promise.reject(new Error("That card has no dev server with a url to open."));
    const res = await post("c1", { action: "open" });
    expect([res.status, await res.json()]).toEqual([400, { error: "That card has no dev server with a url to open." }]);
  });

  it("stop runs dev.stop and answers dev.status", async () => {
    verbs.answer = () => Promise.resolve({ status: { state: "stopped" } });
    const res = await post("c1", { action: "stop" });
    expect([res.status, await res.json()]).toEqual([200, { status: { state: "stopped" } }]);
    expect(verbs.calls).toEqual([["dev.stop", { id: "c1" }], ["dev.status", { id: "c1" }]]);
  });

  it("start and restart run dev.start, restart anew", async () => {
    verbs.answer = () => Promise.resolve({ status: { state: "running" } });
    expect(await (await post("c1", { action: "start" })).json()).toEqual({ status: { state: "running" } });
    await post("c1", { action: "restart" });
    expect(verbs.calls).toEqual([["dev.start", { id: "c1", restart: false }], ["dev.start", { id: "c1", restart: true }]]);
  });

  it("404s a card that isn't here and refuses an action it doesn't know", async () => {
    expect((await post("ghost", { action: "start" })).status).toBe(404);
    const res = await post("c1", { action: "explode" });
    expect([res.status, await res.json()]).toEqual([400, { error: "Unknown action." }]);
    expect(verbs.calls).toEqual([]);
  });

  it("rerun runs dev.restart and log answers dev.log's lines", async () => {
    verbs.answer = () => Promise.resolve({ ok: true });
    expect(await (await post("c1", { action: "rerun" })).json()).toEqual({ ok: true });
    verbs.answer = () => Promise.resolve({ log: "ready" });
    expect(await (await post("c1", { action: "log" })).json()).toEqual({ log: "ready" });
    expect(verbs.calls).toEqual([["dev.restart", { id: "c1" }], ["dev.log", { id: "c1" }]]);
  });
});

describe("GET /cards/:id/dev", () => {
  it("answers dev.status", async () => {
    verbs.answer = () => Promise.resolve({ status: { state: "stopped" } });
    const res = await GET(new Request("http://localhost/api/cards/c1/dev"), { params: Promise.resolve({ id: "c1" }) });
    expect(await res.json()).toEqual({ status: { state: "stopped" } });
    expect(verbs.calls).toEqual([["dev.status", { id: "c1" }]]);
  });
});
