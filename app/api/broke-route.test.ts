import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/broke: the board's report of a build error or a full reload (lib/crash-blame.ts).

const recordBreak = vi.fn();
vi.mock("@/lib/crash-blame", () => ({ recordBreak }));

const route = await import("./broke/route");

function post(body: unknown, token = "1") {
  return route.POST(
    new Request("http://localhost:3457/api/broke", {
      method: "POST",
      headers: { host: "localhost:3457", "x-weft-token": token, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => recordBreak.mockReset());

describe("POST /api/broke", () => {
  it("records a build error with its file and answers the card it marked", async () => {
    recordBreak.mockReturnValue({ id: "c1", title: "t", broke: { kind: "build", at: 5, why: "w" } });
    const res = await post({ kind: "build", file: "./a.ts (1:1)", at: 5 });
    expect(recordBreak).toHaveBeenCalledWith({ kind: "build", at: 5, file: "./a.ts (1:1)" });
    expect(await res.json()).toEqual({ card: { id: "c1", broke: { kind: "build", at: 5, why: "w" } } });
  });

  it("records a reload at now when no time came, and answers null when nobody did it", async () => {
    recordBreak.mockReturnValue(undefined);
    const res = await post({ kind: "reload", at: "soon", file: "" });
    const report = recordBreak.mock.calls[0]?.[0] as { kind: string; at: unknown } | undefined;
    expect(report?.kind).toBe("reload");
    expect(typeof report?.at).toBe("number");
    expect(recordBreak.mock.calls[0]?.[0]).not.toHaveProperty("file");
    expect(await res.json()).toEqual({ card: null });
  });

  it("refuses an unknown kind, a build error without a file, bad JSON and a request without the token", async () => {
    expect((await post({ kind: "server", at: 1 })).status).toBe(400);
    expect((await post({ kind: "build" })).status).toBe(400);
    expect((await post("{")).status).toBe(400);
    expect((await post({ kind: "reload" }, "")).status).toBeGreaterThanOrEqual(400);
    expect(recordBreak).not.toHaveBeenCalled();
  });
});
