import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/blastcp-plan.ts: nudging BlastCP to re-read the Weft plan.

const t = vi.hoisted(() => ({ session: null as { access_token: string } | null, throwClient: false }));
vi.mock("./account", () => ({
  accountClient: () => {
    if (t.throwClient) throw new Error("no accounts");
    return { auth: { getSession: () => Promise.resolve({ data: { session: t.session } }) } };
  },
}));

const { notePlan, syncBlastcpPlan } = await import("./blastcp-plan");

const ok = (body: unknown, status = 200) => vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch;

beforeEach(() => {
  t.session = { access_token: "jwt" };
  t.throwClient = false;
  (globalThis as { __weftLastPlan?: string }).__weftLastPlan = undefined;
});

describe("syncBlastcpPlan", () => {
  it("posts the Weft token to BlastCP and returns its outcome", async () => {
    const f = ok({ outcome: "applied" });
    expect(await syncBlastcpPlan(f)).toBe("applied");
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe("https://blastcp.com/api/weft/plan");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer jwt");
  });

  it("sends nothing signed out or without accounts", async () => {
    const f = ok({});
    t.session = null;
    expect(await syncBlastcpPlan(f)).toBeNull();
    t.throwClient = true;
    expect(await syncBlastcpPlan(f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("is null on a refusal, a body with no outcome, or a network failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await syncBlastcpPlan(ok({ error: "x" }, 401))).toBeNull();
    expect(await syncBlastcpPlan(vi.fn(() => Promise.resolve(new Response("nope"))) as unknown as typeof fetch)).toBeNull();
    expect(await syncBlastcpPlan(vi.fn(() => Promise.reject(new Error("offline"))) as unknown as typeof fetch)).toBeNull();
  });
});

describe("notePlan", () => {
  it("nudges only when the plan changes after the first sighting", () => {
    const sync = vi.fn(() => Promise.resolve(null));
    notePlan("free", sync);
    notePlan("free", sync);
    expect(sync).not.toHaveBeenCalled();
    notePlan("pro", sync);
    expect(sync).toHaveBeenCalledTimes(1);
    notePlan(null, sync);
    notePlan("pro", sync);
    expect(sync).toHaveBeenCalledTimes(1);
  });
});
