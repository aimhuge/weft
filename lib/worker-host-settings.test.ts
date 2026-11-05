// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { workerSettings } from "./worker-host-settings";

// A worker's own settings from Settings → Threads: the verb through /api/worker-settings, followed to its answer.
const SETTINGS = { maxThreads: 3, keepAliveMinutes: 0, worktreePool: 1, defaultBackend: "claude" };
const FAST = { every: 1, unclaimed: 50, claimed: 50, sleep: () => Promise.resolve() };

function serve(command: unknown, post: { ok: boolean; body: unknown } = { ok: true, body: { commandId: "cmd-1" } }) {
  const fetchMock = vi.fn((url: string) => {
    if (url === "/api/worker-settings") return Promise.resolve({ ok: post.ok, status: post.ok ? 200 : 403, json: () => Promise.resolve(post.body) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(command) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("workerSettings", () => {
  it("reads a worker's settings, and saves a patch", async () => {
    const fetchMock = serve({ status: "done", error: null, result: { ok: true, cardId: "", settings: SETTINGS } });
    expect(await workerSettings("w1", undefined, FAST)).toEqual(SETTINGS);
    const sent = (i: number) => JSON.parse(((fetchMock.mock.calls[i] as unknown[])[1] as RequestInit).body as string) as unknown;
    expect(sent(0)).toEqual({ workerId: "w1", verb: "settings.get" });
    expect((fetchMock.mock.calls[1] as unknown[])[0]).toBe("/api/workers?command=cmd-1");
    await workerSettings("w1", { maxThreads: 3 }, FAST);
    expect(sent(2)).toEqual({ workerId: "w1", verb: "settings.put", args: { patch: { maxThreads: 3 } } });
  });

  it("says why when the worker refused, didn't answer, or the server said no", async () => {
    serve({ status: "failed", error: "worktreePool must be 0 to 3.", result: null });
    await expect(workerSettings("w1", { worktreePool: 9 }, FAST)).rejects.toThrow("worktreePool must be 0 to 3.");
    serve({ status: "failed", error: null });
    await expect(workerSettings("w1", undefined, FAST)).rejects.toThrow("Your worker couldn't do that.");
    serve({ status: "pending", error: null });
    await expect(workerSettings("w1", undefined, FAST)).rejects.toThrow("Your worker didn't answer. It may be offline.");
    serve({ status: "done", error: null, result: { ok: true, cardId: "" } });
    await expect(workerSettings("w1", undefined, FAST)).rejects.toThrow("Your worker didn't answer.");
    serve({}, { ok: false, body: { error: "This change needs Weft's own window" } });
    await expect(workerSettings("w1", undefined, FAST)).rejects.toThrow("This change needs Weft's own window");
    serve({}, { ok: false, body: "x" });
    await expect(workerSettings("w1", undefined, FAST)).rejects.toThrow("HTTP 403");
    // A body that isn't JSON reads as empty.
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error("not json")) })));
    await expect(workerSettings("w1", undefined, FAST)).rejects.toThrow("HTTP 502");
  });
});

describe("workerSettings with Goose's provider", () => {
  afterEach(() => {
    delete (window as unknown as { weft?: unknown }).weft;
  });

  it("signs a patch that points Goose elsewhere, after Touch ID, over exactly that patch", async () => {
    const auth = { kind: "ed25519", device: "mac", issuedAt: 1, nonce: "n".repeat(16), sig: "c2ln" };
    const widen = vi.fn(() => Promise.resolve(auth));
    (window as unknown as { weft: unknown }).weft = { approval: { widen } };
    const fetchMock = serve({ status: "done", error: null, result: { ok: true, cardId: "", settings: SETTINGS } });
    await workerSettings("w1", { gooseProviderId: "openai", maxThreads: 2 }, FAST);
    expect(widen).toHaveBeenCalledWith({ host: "w1", card: "", verb: "settings.put", change: { goose: { gooseProviderId: "openai" } }, args: { patch: { gooseProviderId: "openai", maxThreads: 2 } } });
    const sent = JSON.parse(((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body as string) as unknown;
    expect(sent).toEqual({ workerId: "w1", verb: "settings.put", args: { patch: { gooseProviderId: "openai", maxThreads: 2 }, widen: auth } });
  });

  it("sends nothing without the desktop's signer, or when Touch ID is refused", async () => {
    const fetchMock = serve({ status: "done", error: null, result: { ok: true, cardId: "", settings: SETTINGS } });
    await expect(workerSettings("w1", { gooseBaseUrl: "https://x" }, FAST)).rejects.toThrow(/Touch ID/);
    (window as unknown as { weft: unknown }).weft = { approval: { widen: () => Promise.resolve(null) } };
    await expect(workerSettings("w1", { gooseBaseUrl: "https://x" }, FAST)).rejects.toThrow("Not approved");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
