// The worker-pairing wiring (electron/host-pairing-ipc.cjs): three channels on the board-only handler phone pairing
// uses (electron/pairing-ipc.cjs), opening a code with this Mac's key and device id.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { registerHostPairing } from "./host-pairing-ipc.cjs";
import { fakeDb } from "./pairing.harness";
import { setupPairing } from "./pairing-ipc.cjs";
import vaultCrypto from "./vault-crypto.cjs";

const ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PID = "11111111-2222-4333-8444-555555555555";

describe("registerHostPairing", () => {
  it("opens, checks and cancels a worker's code by id", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const rpc = vi.fn(() => Promise.resolve({ data: PID, error: null }));
    registerHostPairing((channel, fn) => handlers.set(channel, fn), {
      db: () => ({ rpc }),
      userId: () => "u1",
      macDevice: () => "mac-id",
      myDevice: () => Promise.resolve({ publicKey: "mac-key" }),
      confirm: () => Promise.resolve(true),
    });
    expect([...handlers.keys()]).toEqual(["host-pairing:start", "host-pairing:check", "host-pairing:cancel", "worker-pins:forget"]);
    expect(await handlers.get("worker-pins:forget")!("w1", "m1mini")).toEqual({ forgotten: false });
    expect(await handlers.get("host-pairing:start")!(ORG)).toMatchObject({ id: PID });
    expect(rpc).toHaveBeenCalledWith("worker_pair_open", { p_org: ORG, p_mac_device: "mac-id", p_mac_key: "mac-key" });
    expect(await handlers.get("host-pairing:check")!("nope")).toEqual({ status: "expired" });
    await expect(handlers.get("host-pairing:cancel")!("nope")).resolves.toBeUndefined();
    await expect(handlers.get("host-pairing:start")!(null)).rejects.toThrow();
  });
});

describe("Re-pin", () => {
  it("forgets a worker's pinned keys only after Touch ID, and pins what a pairing confirmed", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const pins = { pin: vi.fn(), forget: vi.fn(() => true) };
    const confirm = vi.fn(() => Promise.resolve(false));
    const hosts = registerHostPairing((channel, fn) => handlers.set(channel, fn), { db: () => ({}), userId: () => "u1", macDevice: () => "mac-id", myDevice: () => Promise.resolve({ publicKey: "k" }), confirm }, pins);
    expect(await handlers.get("worker-pins:forget")!("w1", "m1mini")).toEqual({ denied: true });
    expect(pins.forget).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith("forget the keys this Mac pinned for the worker m1mini, so its next secret ask pins new ones");
    confirm.mockResolvedValueOnce(true);
    expect(await handlers.get("worker-pins:forget")!("w1")).toEqual({ forgotten: true });
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining("the worker w1"));
    expect(pins.forget).toHaveBeenCalledWith("w1");
    expect(hosts).toBeDefined();
  });
});

describe("in the pairing IPC", () => {
  it("answers the board window only", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-host-ipc-"));
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const ipcMain = { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, fn) };
    const board = { id: "board" };
    const plainStorage = () => ({ isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() });
    setupPairing({ ipcMain, dataDir, accountClient: () => ({ supabase: fakeDb(), getClaims: () => ({ sub: "u1" }) }), isBoard: (s: unknown) => s === board, confirm: () => Promise.resolve(true), safeStorage: plainStorage, crypto: () => vaultCrypto });
    await expect(Promise.resolve(handlers.get("host-pairing:start")!({ sender: { id: "pane" } }, ORG))).rejects.toThrow(/board window/);
    expect(await handlers.get("host-pairing:check")!({ sender: board }, "nope")).toEqual({ status: "expired" });
  });
});
