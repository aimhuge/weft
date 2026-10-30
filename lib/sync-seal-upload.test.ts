import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const shellMock = vi.hoisted(() => vi.fn());
const status = vi.hoisted(() => ({ seal: false }));
vi.mock("./browser-shell", () => ({ shell: shellMock }));
vi.mock("./sync-security", () => ({ pairingStatus: () => Promise.resolve({ approvers: 0, webApprovals: false, seal: status.seal }) }));

const { forgetSyncKey, makeSealer, sealerFor } = await import("./sync-seal-upload");
const { b64, sodium } = await import("./sodium");
const { isSealed } = await import("./sync-seal");

let key: string;
beforeAll(async () => {
  const s = await sodium();
  key = b64(s, s.crypto_aead_xchacha20poly1305_ietf_keygen());
});
beforeEach(() => {
  forgetSyncKey();
  shellMock.mockReset();
  status.seal = false;
});

const item = { org_id: "o", card_id: "c", seq: 0, kind: "user" as const, item: { kind: "user" as const, text: "x", at: 1 }, at: "t" };

describe("sealerFor", () => {
  it("is null while the switch is off", async () => {
    expect(await sealerFor("o")).toBeNull();
    expect(shellMock).not.toHaveBeenCalled();
  });
  it("seals with main's key, asking once a minute", async () => {
    status.seal = true;
    shellMock.mockResolvedValue({ version: 1, key });
    const sealer = await sealerFor("o", 0);
    expect(isSealed(sealer!.item(item).item)).toBe(true);
    await sealerFor("o", 59_000);
    expect(shellMock).toHaveBeenCalledTimes(1);
    expect(shellMock).toHaveBeenCalledWith("/sync/key", { orgId: "o", create: true });
    await sealerFor("o", 61_000);
    expect(shellMock).toHaveBeenCalledTimes(2);
  });
  it("is null when main has no key or isn't there", async () => {
    status.seal = true;
    shellMock.mockResolvedValueOnce({ none: true });
    expect(await sealerFor("o", 0)).toBeNull();
    forgetSyncKey();
    shellMock.mockRejectedValueOnce(new Error("no shell"));
    expect(await sealerFor("o", 0)).toBeNull();
  });
});

describe("makeSealer", () => {
  it("leaves shared cards plain", async () => {
    const s = await sodium();
    const sealer = makeSealer(s, { version: 1, key }, (id) => id === "c");
    expect(sealer.item(item)).toBe(item);
    const card = { org_id: "o", card_id: "c", owner_device: "d", folder: "/", card: { title: "t" } as never, deleted: false, updated_at: "t" };
    expect(sealer.card(card)).toBe(card);
    const tool = { org_id: "o", card_id: "c", tool_id: "t", result: "r", bytes: 1 };
    expect(sealer.tool(tool)).toBe(tool);
    const other = makeSealer(s, { version: 1, key }, () => false);
    expect(other.tool(tool).result).toMatch(/^\{"\$sealed":1/);
    expect((other.card(card).card as { title: string }).title).toBe("🔒");
  });
  it("by default reads the share from the store", async () => {
    const s = await sodium();
    expect(isSealed(makeSealer(s, { version: 1, key }).item(item).item)).toBe(true);
  });
});
