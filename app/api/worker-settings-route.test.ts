import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/worker-settings: one of your workers' own settings, queued as a host verb. Elevated, like every cloud act.
vi.mock("@/lib/shell-token", () => ({ shellToken: () => "tok" }));
vi.mock("@/lib/worker-host-verbs", () => ({ sendWorkerHostVerb: vi.fn(() => Promise.resolve({ commandId: "cmd-1" })) }));

const verbs = await import("@/lib/worker-host-verbs");
const route = await import("./worker-settings/route");

const ELEVATED = { host: "localhost:3457", "x-weft-token": "tok" };
const post = (body: unknown, headers: Record<string, string> = ELEVATED) =>
  route.POST(new Request("http://localhost:3457/api/worker-settings", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

beforeEach(() => vi.clearAllMocks());

describe("POST /api/worker-settings", () => {
  it("queues the verb for the worker with its args", async () => {
    const res = await post({ workerId: "w1", verb: "settings.put", args: { patch: { maxThreads: 2 } } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ commandId: "cmd-1" });
    expect(verbs.sendWorkerHostVerb).toHaveBeenCalledWith({ workerId: "w1", verb: "settings.put", args: { patch: { maxThreads: 2 } } });
    await post({ workerId: "w1", verb: "settings.get", args: [1] });
    expect(verbs.sendWorkerHostVerb).toHaveBeenLastCalledWith({ workerId: "w1", verb: "settings.get", args: undefined });
    await post({ workerId: "w1" });
    expect(verbs.sendWorkerHostVerb).toHaveBeenLastCalledWith({ workerId: "w1", verb: "", args: undefined });
  });

  it("asks for a worker, and reports a refusal", async () => {
    expect((await post({ verb: "settings.get" })).status).toBe(400);
    const garbled = new Request("http://localhost:3457/api/worker-settings", { method: "POST", headers: ELEVATED, body: "{" });
    expect((await route.POST(garbled)).status).toBe(400);
    vi.mocked(verbs.sendWorkerHostVerb).mockRejectedValueOnce(new Error("That worker isn't one of yours."));
    const res = await post({ workerId: "w9", verb: "settings.get" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "That worker isn't one of yours." });
  });

  it("refuses a request that isn't from Weft's own window", async () => {
    expect((await post({ workerId: "w1", verb: "settings.get" }, { host: "localhost:3457" })).status).toBe(403);
    expect(verbs.sendWorkerHostVerb).not.toHaveBeenCalled();
  });
});
