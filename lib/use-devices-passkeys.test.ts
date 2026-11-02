// Letting this Mac's passkeys approve on a worker (lib/use-devices.ts sendPasskeys): main's endorsement of the whole
// set, sent until the worker confirms it (lib/passkey-sync.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";

const endorse = vi.hoisted(() => vi.fn<(w: string) => Promise<unknown[] | null>>());
vi.mock("./widen-signer", () => ({ endorsePasskeys: endorse, canSignWiden: () => true, refreshEndorsements: vi.fn(), confirmEndorsement: vi.fn() }));

const { sendPasskeys } = await import("./use-devices");

beforeEach(() => vi.clearAllMocks());

describe("sendPasskeys", () => {
  it("says the worker trusts them once it confirmed, or that they're on their way", async () => {
    endorse.mockResolvedValueOnce([{ passkeys: [1] }]);
    expect(await sendPasskeys("w1", "m1mini", () => Promise.resolve([]))).toBe("m1mini now lets your passkey approve changes there.");
    endorse.mockResolvedValueOnce([{ passkeys: [1, 2] }]);
    expect(await sendPasskeys("w1", "m1mini", () => Promise.resolve(["w1"]))).toMatch(/^Sent: m1mini will let your 2 passkeys/);
  });

  it("sends nothing when Touch ID is refused or no passkey is paired", async () => {
    const sync = vi.fn(() => Promise.resolve([]));
    endorse.mockResolvedValueOnce(null);
    expect(await sendPasskeys("w1", "m1mini", sync)).toMatch(/Not approved/);
    endorse.mockResolvedValueOnce([]);
    expect(await sendPasskeys("w1", "m1mini", sync)).toMatch(/No passkey is paired/);
    expect(sync).not.toHaveBeenCalled();
  });
});
