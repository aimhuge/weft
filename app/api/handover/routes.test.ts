// Your answer to a teammate's ask for one of your cards (app/api/handover/route.ts); lib/handover.test.ts covers the push.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
const guard = vi.hoisted(() => ({ elevated: null as Response | null }));
vi.mock("@/lib/guard", () => ({ elevated: () => guard.elevated, fail: (err: Error, status = 400) => Response.json({ error: err.message }, { status }) }));
const handover = vi.hoisted(() => ({ answerHandover: vi.fn((): Promise<unknown> => Promise.resolve({ branch: "weft/handover/c1" })) }));
vi.mock("@/lib/handover", () => handover);

const route = await import("./route");
const post = (body: unknown) => route.POST(new Request("http://localhost/api/handover", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  guard.elevated = null;
  vi.clearAllMocks();
});

describe("POST /api/handover", () => {
  it("needs Weft's own window", async () => {
    guard.elevated = new Response("no", { status: 403 });
    expect((await post({ card: "c1", yes: true })).status).toBe(403);
    expect(handover.answerHandover).not.toHaveBeenCalled();
  });

  it("needs the card and a yes or no", async () => {
    expect((await post({ yes: true })).status).toBe(400);
    expect((await post({ card: "c1" })).status).toBe(400);
    expect((await post("nope")).status).toBe(400);
  });

  it("answers", async () => {
    expect(await (await post({ card: "c1", yes: true })).json()).toEqual({ branch: "weft/handover/c1" });
    expect(handover.answerHandover).toHaveBeenCalledWith("c1", true);
  });

  it("says why it couldn't", async () => {
    handover.answerHandover.mockRejectedValueOnce(new Error("Couldn't push this card's work: denied"));
    const res = await post({ card: "c1", yes: true });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Couldn't push this card's work: denied" });
  });
});
