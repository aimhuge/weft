// The pairing wiring (electron/pairing-ipc.cjs): board-window-only IPC, Touch ID before the web may approve alone,
// and the control routes the server reads.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "./pairing.harness";
import { setupPairing } from "./pairing-ipc.cjs";
import vaultCrypto from "./vault-crypto.cjs";
import { createGooseSetRecord } from "./worker-goose-set.cjs";

const plainStorage = () => ({ isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() });

function setup(confirm = vi.fn(() => Promise.resolve(true))) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-pair-ipc-"));
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ipcMain = { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, fn) };
  const db = fakeDb();
  const board = { id: "board" };
  const wired = setupPairing({ ipcMain, dataDir, accountClient: () => ({ supabase: db, getClaims: () => ({ sub: "u1" }) }), isBoard: (s: unknown) => s === board, confirm, safeStorage: plainStorage, crypto: () => vaultCrypto });
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: board }, ...args);
  return { handlers, call, wired, confirm, db, dataDir, board };
}

describe("pairing IPC", () => {
  it("answers the board window only", async () => {
    const { handlers } = setup();
    await expect(Promise.resolve(handlers.get("pairing:list")!({ sender: { id: "pane" } }))).rejects.toThrow(/board window/);
  });

  it("lists, reads and sets the switches, asking Touch ID before the web may approve alone", async () => {
    const confirm = vi.fn(() => Promise.resolve(false));
    const { call } = setup(confirm);
    expect(await call("pairing:list")).toEqual([]);
    expect(await call("pairing:settings")).toEqual({ seal: false, webApprovals: false });
    expect(await call("pairing:set-settings", { webApprovals: true })).toEqual({ seal: false, webApprovals: false });
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/without your phone/));
    expect(await call("pairing:set-settings", { seal: true })).toEqual({ seal: true, webApprovals: false });
    confirm.mockResolvedValueOnce(true);
    expect(await call("pairing:set-settings", { webApprovals: true })).toEqual({ seal: true, webApprovals: true });
    expect(await call("pairing:set-settings", { webApprovals: false })).toEqual({ seal: true, webApprovals: false });
    expect(await call("pairing:set-settings", null)).toEqual({ seal: true, webApprovals: false });
  });

  it("serves the server's routes", async () => {
    const { wired } = setup();
    expect(wired.routes["POST /pairing/status"]()).toEqual({ approvers: 0, devices: 0, seal: false, webApprovals: false });
    expect(await wired.routes["POST /pairing/verify"]({ device: "d", message: "m", sig: "s" })).toMatchObject({ ok: false });
    expect(wired.routes["POST /pairing/passkey-verify"]({ device: "d", credId: "c", message: "m" })).toEqual({ ok: false, reason: "That device isn't paired with this Mac." });
    // A widening's nonce is spent in main, once (electron/widen-nonces.cjs).
    const spend = { nonce: "nonce-000000000001", issuedAt: Date.now() + 1000 };
    expect(wired.routes["POST /pairing/widen-nonce"](spend)).toEqual({ ok: true });
    expect(wired.routes["POST /pairing/widen-nonce"](spend)).toEqual({ ok: false });
    expect(wired.routes["POST /pairing/widen-nonce"](null)).toEqual({ ok: false });
  });

  it("registers this Mac before making a key, and says so when it can't", async () => {
    const { wired, db, dataDir, call } = setup();
    // registerDevice needs a signed-in user's id from getClaims; the fake's upsert isn't there, so registration fails loudly.
    await expect(wired.routes["POST /sync/key"]({ orgId: "o", create: true })).rejects.toThrow();
    db.tables.devices = [];
    fs.writeFileSync(path.join(dataDir, "device-id"), "mac-id\n");
    await expect(call("pairing:check", "nope")).resolves.toEqual({ status: "expired" });
    await call("pairing:cancel", "nope");
  });

  it("finds this Mac's row and makes the first key", async () => {
    const { wired, db, dataDir } = setup();
    await vaultCrypto.ready();
    // The device key is made on first read; put its row in place as registration would.
    const { loadDeviceKey } = await import("./device-key.cjs");
    const pair = loadDeviceKey({ dir: dataDir, safeStorage: plainStorage(), crypto: vaultCrypto });
    db.tables.devices = [{ id: "mac-row", user_id: "u1", public_key: pair.publicKey }];
    expect(await wired.routes["POST /sync/key"]({ orgId: "o" })).toEqual({ none: true });
    expect(await wired.routes["POST /sync/key"]({ orgId: "o", create: true })).toMatchObject({ version: 1 });
    expect(db.tables.workspace_key_grants[0]!).toMatchObject({ device_id: "mac-row", version: 1 });
  });
});

describe("passkey heads and reconciling", () => {
  it("publishes a worker's head into its log with each set, and reconciles before a refresh", async () => {
    const { call, db, dataDir } = setup();
    fs.writeFileSync(path.join(dataDir, "device-id"), "d".repeat(64));
    const [set] = (await call("approval:endorse", { worker: "w1", revoke: true })) as { generation: number }[];
    expect(db.tables.worker_passkey_heads).toEqual([expect.objectContaining({ worker_id: "w1", head: expect.objectContaining({ worker: "w1", generation: set?.generation, mac: "d".repeat(64) }) as unknown })]);
    expect(await call("approval:endorse-refresh")).toHaveLength(1);
  });

  it("still hands the set back when the log refuses the head", async () => {
    const { call, db, dataDir } = setup();
    fs.writeFileSync(path.join(dataDir, "device-id"), "d".repeat(64));
    const from = db.from;
    db.from = ((name: string) => (name === "worker_passkey_heads" ? { insert: () => Promise.resolve({ data: null, error: { message: "no such table" } }) } : from(name))) as typeof db.from;
    expect(await call("approval:endorse", { worker: "w1", revoke: true })).toHaveLength(1);
  });
});

describe("a worker's Goose settings", () => {
  it("remembers the provider and endpoint this Mac signed for a worker, for its Goose key asks", async () => {
    const { call, dataDir } = setup();
    fs.writeFileSync(path.join(dataDir, "device-id"), "d".repeat(64));
    const goose = { gooseProviderId: "anthropic", gooseBaseUrl: "https://gw" };
    expect(await call("approval:widen", { host: "w1", card: "", verb: "settings.put", change: { goose }, args: { patch: goose } })).toMatchObject({ kind: "ed25519" });
    expect(createGooseSetRecord({ dir: dataDir, safeStorage: plainStorage }).of("w1")).toEqual({ providerId: "anthropic", baseUrl: "https://gw" });
  });
});

describe("Keep on this worker's wiring", () => {
  it("answers the board's calls and watches the vault it's handed", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-pair-keep-"));
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const ipcMain = { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, fn) };
    const board = { id: "board" };
    const setValue = vi.fn<(folder: string, name: string, environment: string, value: string) => Promise<{ saved: boolean }>>(() => Promise.resolve({ saved: true }));
    const vault = { setValue, remove: vi.fn(() => Promise.resolve({})), valuesFor: vi.fn(() => Promise.resolve({ id: "github:o/r", label: "o/r", values: {} })) };
    setupPairing({ ipcMain, dataDir, accountClient: () => ({ supabase: fakeDb(), getClaims: () => ({ sub: "u1" }) }), isBoard: (s: unknown) => s === board, confirm: vi.fn(), safeStorage: plainStorage, crypto: () => vaultCrypto, vault });
    expect(await handlers.get("worker-keep:list")!({ sender: board }, "w1")).toEqual({ kept: [], repos: [], environments: ["development", "preview"] });
    await expect(Promise.resolve(handlers.get("worker-keep:wipe")!({ sender: { id: "pane" } }, "w1"))).rejects.toThrow(/board window/);
    expect(vault.setValue).not.toBe(setValue);
    expect(await vault.setValue("/p", "A", "development", "v")).toEqual({ saved: true });
    expect(setValue).toHaveBeenCalled();
  });
});
