import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCard: vi.fn(), getThread: vi.fn(), guard: vi.fn() }));
vi.mock("@/lib/store", () => ({ getCard: mocks.getCard, getThread: mocks.getThread }));
vi.mock("@/lib/guard", async (original) => ({ ...(await original<typeof import("@/lib/guard")>()), guard: mocks.guard }));

import { GET } from "./route";

const call = (url = "http://x/?q=needle") => GET(new Request(url), { params: Promise.resolve({ id: "c" }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCard.mockReturnValue({ id: "c" });
});

describe("GET thread search", () => {
  it("matches the whole stored thread, long tool results included", async () => {
    const long = `${"x".repeat(5000)}needle`;
    mocks.getThread.mockReturnValue([{ kind: "user", text: "no", at: 0 }, { kind: "tool", id: "t", name: "Bash", summary: "ls", result: long, at: 0 }]);
    expect(await (await call()).json()).toEqual({ matches: [{ index: 1, hits: 1 }] });
  });

  it("finds nothing with no query", async () => {
    mocks.getThread.mockReturnValue([{ kind: "user", text: "x", at: 0 }]);
    expect(await (await call("http://x/")).json()).toEqual({ matches: [] });
  });

  it("answers 404 for a card that's gone, and the guard's refusal first", async () => {
    mocks.getCard.mockReturnValue(undefined);
    expect((await call()).status).toBe(404);
    mocks.guard.mockReturnValue(new Response(null, { status: 403 }));
    expect((await call()).status).toBe(403);
  });
});
