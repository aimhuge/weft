// Letting this Mac's passkeys approve on a worker (lib/use-devices.ts sendPasskeys): main's endorsements, sent as a pin.
import { beforeEach, describe, expect, it, vi } from "vitest";

const endorse = vi.hoisted(() => vi.fn<(w: string) => Promise<unknown[] | null>>());
vi.mock("./widen-signer", () => ({ endorsePasskeys: endorse, canSignWiden: () => true }));
const apiFetch = vi.hoisted(() => vi.fn(() => Promise.resolve(new Response(JSON.stringify({ commandId: "c" }), { status: 200 }))));
vi.mock("./api-client", () => ({ apiFetch }));

const { sendPasskeys } = await import("./use-devices");

beforeEach(() => vi.clearAllMocks());

describe("sendPasskeys", () => {
  it("sends one passkey's endorsement or several, and says so", async () => {
    endorse.mockResolvedValueOnce([{ e: 1 }]);
    expect(await sendPasskeys("w1", "m1mini")).toMatch(/your passkey approve/);
    expect(apiFetch).toHaveBeenCalledWith("/api/worker-board", { method: "POST", body: JSON.stringify({ action: "pin", workerId: "w1", endorsements: [{ e: 1 }] }) });
    endorse.mockResolvedValueOnce([{ e: 1 }, { e: 2 }]);
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
