import { describe, expect, it, vi } from "vitest";

// /api/cards/[id]/share: GET and PUT behind the localhost guard (PUT also needs x-weft-token), handing the
// card and the update to lib/card-share and turning its refusals into their status.

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/card-share", () => {
  class CardShareError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return {
    CardShareError,
    getCardShare: vi.fn(() => Promise.resolve({ kind: "pending" })),
    setCardShare: vi.fn(() => Promise.resolve({ kind: "ok", id: "s1", url: "https://weft.zip/s/s1", mode: "public", hasPassword: false })),
  };
});

const lib = await import("@/lib/card-share");
const route = await import("./cards/[id]/share/route");

const URL = "http://localhost:3457/api/cards/c1/share";
const READ = { host: "localhost:3457" };
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };
const params = { params: Promise.resolve({ id: "c1" }) };
const put = (body: string, headers: Record<string, string> = WRITE) => route.PUT(new Request(URL, { method: "PUT", headers, body }), params);

describe("GET /api/cards/[id]/share", () => {
  it("answers the card's share state", async () => {
    const res = await route.GET(new Request(URL, { headers: READ }), params);
    expect(await res.json()).toEqual({ kind: "pending" });
    expect(lib.getCardShare).toHaveBeenLastCalledWith("c1");
  });

  it("refuses other hosts", async () => {
    const res = await route.GET(new Request("http://evil.test/api/cards/c1/share", { headers: { host: "evil.test" } }), params);
    expect(res.status).toBe(403);
  });

  it("turns a missing card into a 404 and anything else into a 500", async () => {
    vi.mocked(lib.getCardShare).mockRejectedValueOnce(new lib.CardShareError("No such card.", 404));
    const missing = await route.GET(new Request(URL, { headers: READ }), params);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "No such card." });
    vi.mocked(lib.getCardShare).mockRejectedValueOnce(new Error("supabase down"));
    expect((await route.GET(new Request(URL, { headers: READ }), params)).status).toBe(500);
  });
});

describe("PUT /api/cards/[id]/share", () => {
  it("saves the mode and password and answers the new state", async () => {
    const res = await put(JSON.stringify({ mode: "password", password: "pw" }));
    expect(await res.json()).toMatchObject({ kind: "ok", url: "https://weft.zip/s/s1" });
    expect(lib.setCardShare).toHaveBeenLastCalledWith("c1", { mode: "password", password: "pw" });
  });

  it("passes the chat switch and a trimmed slug through", async () => {
    await put(JSON.stringify({ mode: "public", showChat: false, slug: " login-fix " }));
    expect(lib.setCardShare).toHaveBeenLastCalledWith("c1", { mode: "public", showChat: false, slug: "login-fix" });
  });

  it("needs the write header and a JSON body", async () => {
    expect((await put("{}", { host: "localhost:3457" })).status).toBe(403);
    const bad = await put("not json");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Send { mode, password?, showChat?, slug? }." });
  });

  it("passes a refusal's status through", async () => {
    vi.mocked(lib.setCardShare).mockRejectedValueOnce(new lib.CardShareError("Set a password first.", 400));
    const res = await put(JSON.stringify({ mode: "password" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Set a password first." });
  });
});
