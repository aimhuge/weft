// Sending each worker this Mac's passkey set until it confirms (lib/passkey-sync.ts): a pin row that's deleted, dropped
// or refused leaves the worker listed, and the set is sent again; one still on its way isn't sent twice.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandResult } from "./worker-command-wait";

vi.mock("./widen-signer", () => ({ refreshEndorsements: vi.fn(), confirmEndorsement: vi.fn() }));
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("./api-client", () => ({ apiFetch }));

const { forgetSentPins, passkeySyncDeps, syncPasskeys } = await import("./passkey-sync");

const NOW_WAIT = { every: 0, unclaimed: -1, claimed: -1, sleep: () => Promise.resolve() };

function deps(statuses: CommandResult[], confirm = true) {
  let at = 0;
  return {
    refresh: vi.fn(() => Promise.resolve([{ worker: "w1", generation: 5, endorsements: [{ e: 1 }] }])),
    post: vi.fn(() => Promise.resolve(`cmd-${++at}`)),
    status: vi.fn(() => Promise.resolve(statuses.shift() ?? { status: "pending" as const, error: null })),
    confirm: vi.fn(() => Promise.resolve(confirm)),
    wait: NOW_WAIT,
  };
}

beforeEach(() => {
  forgetSentPins();
  vi.clearAllMocks();
});

describe("syncPasskeys", () => {
  it("is done with a worker once main takes its signed receipt", async () => {
    const d = deps([{ status: "done", error: null, result: { ok: true, value: { generation: 5, sig: "s" } } }]);
    expect(await syncPasskeys(d)).toEqual([]);
    expect(d.post).toHaveBeenCalledWith("w1", [{ e: 1 }]);
    expect(d.confirm).toHaveBeenCalledWith("w1", { generation: 5, sig: "s" });
  });

  it("keeps a worker listed when its receipt doesn't check out, the row failed or went, and sends again next time", async () => {
    const forged = deps([{ status: "done", error: null, result: { ok: true, value: { generation: 5 } } }], false);
    expect(await syncPasskeys(forged)).toEqual(["w1"]);
    const failed = deps([{ status: "failed", error: "too old", result: null }]);
    expect(await syncPasskeys(failed)).toEqual(["w1"]);
    const gone = deps([]);
    gone.status.mockRejectedValue(new Error("That command is gone."));
    expect(await syncPasskeys(gone)).toEqual(["w1"]);
    expect(failed.post).toHaveBeenCalledTimes(1);
  });

  it("checks a pin still on its way instead of sending another, until the generation changes", async () => {
    const d = deps([]);
    expect(await syncPasskeys(d)).toEqual(["w1"]);
    expect(await syncPasskeys(d)).toEqual(["w1"]);
    expect(d.post).toHaveBeenCalledTimes(1);
    d.refresh.mockResolvedValueOnce([{ worker: "w1", generation: 6, endorsements: [{ e: 2 }] }]);
    await syncPasskeys(d);
    expect(d.post).toHaveBeenLastCalledWith("w1", [{ e: 2 }]);
  });
});

describe("passkeySyncDeps", () => {
  it("posts a pin and reads its command through the board's api", async () => {
    apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ commandId: "c1" }), { status: 200 }));
    expect(await passkeySyncDeps.post("w1", [{ e: 1 }])).toBe("c1");
    expect(apiFetch).toHaveBeenCalledWith("/api/worker-board", { method: "POST", body: JSON.stringify({ action: "pin", workerId: "w1", endorsements: [{ e: 1 }] }) });
    apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ status: "done", error: null }), { status: 200 }));
    expect(await passkeySyncDeps.status("c 1")).toEqual({ status: "done", error: null });
    expect(apiFetch).toHaveBeenLastCalledWith("/api/workers?command=c%201");
    apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "nope" }), { status: 400 }));
    await expect(passkeySyncDeps.status("c1")).rejects.toThrow("nope");
    apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500 }));
    await expect(passkeySyncDeps.status("c1")).rejects.toThrow("HTTP 500");
  });
});
