// The manual QA switch on a worker's card (lib/qa-switch.ts): nothing runs without the yes, so an approval that
// doesn't come leaves no grant and no command behind.
import { beforeEach, describe, expect, it, vi } from "vitest";

const shell = vi.hoisted(() => vi.fn());
const listDevices = vi.hoisted(() => vi.fn());
const deviceId = vi.hoisted(() => vi.fn());
const refreshCloudInbox = vi.hoisted(() => vi.fn());
const grantQa = vi.hoisted(() => vi.fn());
const revokeQa = vi.hoisted(() => vi.fn());
const activeGrant = vi.hoisted(() => vi.fn());

vi.mock("./browser-shell", () => ({ shell }));
vi.mock("./simulator-devices", () => ({ listDevices }));
vi.mock("./device-id", () => ({ deviceId }));
vi.mock("./cloud-inbox", () => ({ refreshCloudInbox }));
vi.mock("./qa-grants", () => ({ grantQa, revokeQa, activeGrant }));

const { qaState, switchQa } = await import("./qa-switch");

const TARGET = { workerName: "MacBook", orgId: "org-1", device: "worker:w-1", folder: "weft", cardId: "card-1", workerId: "w-1" };

const IOS = { id: "udid-1", name: "iPhone 17", platform: "ios", state: "booted" };
const ANDROID = { id: "emulator-5554", name: "Pixel", platform: "android", state: "shutdown" };

beforeEach(() => {
  vi.clearAllMocks();
  listDevices.mockResolvedValue([IOS, ANDROID]);
  deviceId.mockReturnValue("mac-1");
  shell.mockResolvedValue({ approved: true });
  refreshCloudInbox.mockResolvedValue(undefined);
});

describe("switchQa", () => {
  it("throws and leaves no grant and no command when the user didn't approve", async () => {
    shell.mockResolvedValue({ approved: false });
    await expect(switchQa(TARGET.cardId, IOS.id, TARGET)).rejects.toThrow("Manual QA stays off");
    expect(grantQa).not.toHaveBeenCalled();
  });

  it("throws when the approval says nothing", async () => {
    shell.mockResolvedValue({});
    await expect(switchQa(TARGET.cardId, IOS.id, TARGET)).rejects.toThrow("Manual QA stays off");
    expect(grantQa).not.toHaveBeenCalled();
  });

  it("grants and returns a qa command naming this Mac", async () => {
    const row = await switchQa(TARGET.cardId, IOS.id, TARGET);
    expect(grantQa).toHaveBeenCalledWith({ cardId: "card-1", workerId: "w-1", device: "udid-1", name: "iPhone 17" });
    expect(row).toMatchObject({ kind: "qa", target_device: "worker:w-1", folder: "weft", payload: { cardId: "card-1", device: "mac-1" } });
    expect(shell).toHaveBeenCalledWith("/qa/approve", { worker: "MacBook", folder: "weft", device: "iPhone 17" });
  });

  it("grants an android device by its name, not its serial", async () => {
    await switchQa(TARGET.cardId, ANDROID.name, TARGET);
    expect(grantQa).toHaveBeenCalledWith({ cardId: "card-1", workerId: "w-1", device: "Pixel", name: "Pixel" });
  });

  it("revokes and sends null when the switch is turned off", async () => {
    const row = await switchQa(TARGET.cardId, null, TARGET);
    expect(revokeQa).toHaveBeenCalledWith("card-1");
    expect(row).toMatchObject({ kind: "qa", payload: { cardId: "card-1", device: null } });
    expect(shell).not.toHaveBeenCalled();
    expect(grantQa).not.toHaveBeenCalled();
  });

  it("throws for a device that isn't on this Mac", async () => {
    await expect(switchQa(TARGET.cardId, "udid-nobody", TARGET)).rejects.toThrow("isn't on this Mac");
    expect(grantQa).not.toHaveBeenCalled();
    expect(shell).not.toHaveBeenCalled();
  });
});

describe("qaState", () => {
  it("lists this Mac's devices and its id, with nothing approved", async () => {
    activeGrant.mockReturnValue(undefined);
    expect(await qaState(null)).toEqual({ devices: [IOS, ANDROID], mac: "mac-1", approved: null });
  });

  it("names the approved device for a card with a grant", async () => {
    activeGrant.mockReturnValue({ cardId: "card-1", workerId: "w-1", device: "udid-1", name: "iPhone 17", until: Date.now() + 1_000 });
    const state = await qaState("card-1");
    expect(state.approved).toBe("iPhone 17");
    expect(activeGrant).toHaveBeenCalledWith("card-1");
  });

  it("says nothing is approved for a card with no grant", async () => {
    activeGrant.mockReturnValue(undefined);
    expect((await qaState("card-1")).approved).toBeNull();
  });
});
