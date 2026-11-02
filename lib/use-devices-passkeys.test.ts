// Letting this Mac's passkeys approve on a worker (lib/use-devices.ts sendPasskeys): main's endorsements, sent as a pin.
import { beforeEach, describe, expect, it, vi } from "vitest";

const endorse = vi.hoisted(() => vi.fn<(w: string) => Promise<unknown[] | null>>());
const refresh = vi.hoisted(() => vi.fn<() => Promise<{ worker: string; endorsements: unknown[] }[]>>());
vi.mock("./widen-signer", () => ({ endorsePasskeys: endorse, refreshEndorsements: refresh, canSignWiden: () => true }));
const apiFetch = vi.hoisted(() => vi.fn(() => Promise.resolve(new Response(JSON.stringify({ commandId: "c" }), { status: 200 }))));
vi.mock("./api-client", () => ({ apiFetch }));

const { resendPasskeys, sendPasskeys } = await import("./use-devices");

beforeEach(() => vi.clearAllMocks());

describe("sendPasskeys", () => {
  it("sends one passkey's endorsement or several, and says so", async () => {
    endorse.mockResolvedValueOnce([{ passkeys: [1] }]);
    expect(await sendPasskeys("w1", "m1mini")).toMatch(/your passkey approve/);
    expect(apiFetch).toHaveBeenCalledWith("/api/worker-board", { method: "POST", body: JSON.stringify({ action: "pin", workerId: "w1", endorsements: [{ passkeys: [1] }] }) });
    endorse.mockResolvedValueOnce([{ passkeys: [1, 2] }]);
    expect(await sendPasskeys("w1", "m1mini")).toMatch(/your 2 passkeys/);
  });

  it("sends nothing when Touch ID is refused or no passkey is paired", async () => {
    endorse.mockResolvedValueOnce(null);
    expect(await sendPasskeys("w1", "m1mini")).toMatch(/Not approved/);
    endorse.mockResolvedValueOnce([]);
    expect(await sendPasskeys("w1", "m1mini")).toMatch(/No passkey is paired/);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("resendPasskeys", () => {
  it("sends each endorsed worker its narrowed set, and names the ones it couldn't reach", async () => {
    refresh.mockResolvedValueOnce([{ worker: "w1", endorsements: [{ passkeys: [] }] }]);
    await resendPasskeys();
    expect(apiFetch).toHaveBeenCalledWith("/api/worker-board", { method: "POST", body: JSON.stringify({ action: "pin", workerId: "w1", endorsements: [{ passkeys: [] }] }) });
    refresh.mockResolvedValueOnce([{ worker: "gone-worker-1", endorsements: [] }, { worker: "w1", endorsements: [] }]);
    apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "That worker isn't one of yours." }), { status: 400 }));
    await expect(resendPasskeys()).rejects.toThrow(/gone-wor couldn't be told/);
    expect(apiFetch).toHaveBeenCalledTimes(3);
  });
});
