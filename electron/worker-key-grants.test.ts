// Main's side of a worker's key grant (electron/worker-key-grants.cjs), held to the worker's check (lib/worker-key-grant.ts):
// what main makes, a worker takes; and only for a worker of yours whose box key main pinned, after Touch ID.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createWorkerKeyGrants, grantMessage as mainMessage, grantPurpose as mainPurpose, registerWorkerKeyGrants } from "./worker-key-grants.cjs";
import { macSigner } from "../lib/mac-signer.harness";
import { acceptGrant, grantMessage, grantPurpose } from "../lib/worker-key-grant";
import { newSealKeys } from "../lib/worker-seal";

const ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const W = "11111111-2222-4333-8444-555555555555";
const plainStorage = () => ({ encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() });

function fakeDb(worker: Record<string, unknown>) {
  const grants: Record<string, unknown>[] = [];
  const deleted: string[] = [];
  const db = () => ({
    from: (table: string) => ({
      select: () =>
        table === "cloud_workers"
          ? { eq: (_c: string, id: string) => ({ maybeSingle: () => Promise.resolve({ data: id === worker.id ? worker : null }) }) }
          : Promise.resolve({ data: table === "worker_key_grants" ? grants.map((g) => ({ worker_id: g.worker_id, org_id: g.org_id, version: g.version })) : [{ org_id: ORG, version: 1 }, { org_id: ORG, version: 2 }] }),
      insert: (row: Record<string, unknown>) => {
        grants.push(row);
        return Promise.resolve({ error: null });
      },
      delete: () => ({
        eq: (_c: string, id: string) => {
          deleted.push(id);
          for (let i = grants.length - 1; i >= 0; i--) if (grants[i]!.worker_id === id) grants.splice(i, 1);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  });
  return { db, grants, deleted };
}

function setup(over: { pin?: { publicKey?: string; signKey?: string } | null; sealOn?: boolean; confirm?: boolean; row?: Record<string, unknown> } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-wkg-"));
  const box = newSealKeys();
  const mac = macSigner();
  const worker = { id: W, org_id: ORG, owner_user: "u1", name: "m1mini", public_key: box.publicKey, revoked_at: null, ...over.row };
  const { db, grants, deleted } = fakeDb(worker);
  const ring = new Map([[1, Buffer.alloc(32, 1).toString("base64")]]);
  const syncKeys = {
    current: vi.fn(() => Promise.resolve({ version: 1, key: ring.get(1) })),
    keyring: vi.fn(() => Promise.resolve(ring)),
    rotate: vi.fn(() => {
      const v = ring.size + 1;
      ring.set(v, Buffer.alloc(32, v).toString("base64"));
      return Promise.resolve(v);
    }),
  };
  const confirm = vi.fn(() => Promise.resolve(over.confirm ?? true));
  let pin = over.pin === undefined ? { publicKey: box.publicKey, signKey: "sk" } : over.pin;
  const grantsApi = createWorkerKeyGrants({
    dir,
    safeStorage: plainStorage,
    db,
    userId: () => "u1",
    macDevice: () => "mac-1",
    sign: (m: string) => Promise.resolve(mac.sign(m)),
    pins: { pinned: () => pin },
    syncKeys,
    confirm,
    sealOn: () => over.sealOn ?? true,
    keepFor: () => [{ id: "phone", boxKey: "pk" }],
  });
  return { api: grantsApi, box, mac, grants, deleted, syncKeys, confirm, ring, setPin: (p: typeof pin) => (pin = p) };
}

describe("grantMessage", () => {
  it("is the worker's, byte for byte, and so is the purpose", () => {
    const g = { orgId: ORG, workerId: W, version: 7, boxKey: "BOX", sealed: '{"v":1}' };
    expect(mainMessage(g)).toBe(grantMessage(g));
    expect(mainPurpose(ORG, W, 7)).toBe(grantPurpose(ORG, W, 7));
  });
});

describe("createWorkerKeyGrants", () => {
  it("grants every version after Touch ID, sealed to the pinned box key and signed: the worker takes each", async () => {
    const t = setup();
    t.ring.set(2, Buffer.alloc(32, 2).toString("base64"));
    expect(await t.api.grant(W)).toEqual({ version: 2 });
    expect(t.confirm).toHaveBeenCalledWith("give the worker m1mini the key to your sealed threads");
    expect(t.syncKeys.current).toHaveBeenCalledWith(ORG, { create: true });
    expect(t.grants).toHaveLength(2);
    for (const row of t.grants) {
      const got = acceptGrant(row, { orgId: ORG, workerId: W, keys: t.box, macs: [t.mac.key] });
      expect(got).toEqual({ key: { version: row.version, key: t.ring.get(row.version as number) } });
      expect(row.mac_device).toBe("mac-1");
    }
    // The file main keeps is sealed (here: plain storage) in its vault folder.
    expect(fs.existsSync(t.api.file)).toBe(true);
  });

  it("grants nothing when Touch ID is refused, sealing is off, or the worker isn't one main can vouch for", async () => {
    const denied = setup({ confirm: false });
    expect(await denied.api.grant(W)).toEqual({ denied: true });
    expect(denied.grants).toHaveLength(0);
    await expect(setup({ sealOn: false }).api.grant(W)).rejects.toThrow(/Turn on Seal synced threads/);
    await expect(setup().api.grant("other")).rejects.toThrow(/isn't one of yours/);
    await expect(setup({ row: { owner_user: "u2" } }).api.grant(W)).rejects.toThrow(/isn't one of yours/);
    await expect(setup({ row: { revoked_at: "2026-11-03" } }).api.grant(W)).rejects.toThrow(/isn't one of yours/);
    await expect(setup({ pin: null }).api.grant(W)).rejects.toThrow(/enrolled by token/);
    await expect(setup({ pin: { signKey: "sk" } }).api.grant(W)).rejects.toThrow(/hasn't pinned/);
    // The row's key was swapped (someone holding its wwk_ key): main seals to nothing it didn't pin.
    await expect(setup({ row: { public_key: newSealKeys().publicKey } }).api.grant(W)).rejects.toThrow(/box key changed/);
  });

  it("grants the new version after a rotation, and forgets a worker whose pin went", async () => {
    const t = setup();
    await t.api.grant(W);
    const v = await t.syncKeys.rotate();
    await t.api.regrant(ORG, v);
    expect(t.grants.map((g) => g.version)).toEqual([1, 2]);
    await t.api.regrant("other-org", v);
    await t.api.regrant(ORG, 99);
    t.setPin({ signKey: "sk" });
    await t.api.regrant(ORG, v);
    expect(await t.api.drop(W)).toEqual({ dropped: false });
  });

  it("drops a worker's grants and rotates on Re-pin or Revoke, and reports who holds which version", async () => {
    const t = setup();
    await t.api.grant(W);
    expect(await t.api.status()).toEqual({ sealOn: true, workers: { [W]: { version: 1, latest: 2 } } });
    const r = await t.api.drop(W);
    expect(r).toEqual({ dropped: true, version: 2 });
    expect(t.syncKeys.rotate).toHaveBeenCalledWith(ORG, [{ id: "phone", boxKey: "pk" }]);
    expect(t.deleted).toEqual([W]);
    expect(t.grants).toHaveLength(0);
    // A worker this Mac never granted only has its rows deleted.
    expect(await t.api.drop("other")).toEqual({ dropped: false });
  });

  it("throws what the database said when a write fails, and takes a duplicate as granted", async () => {
    const t = setup();
    const failing = createWorkerKeyGrants({
      dir: fs.mkdtempSync(path.join(os.tmpdir(), "weft-wkg-")),
      safeStorage: plainStorage,
      db: () => ({ from: () => ({ delete: () => ({ eq: () => Promise.resolve({ error: { message: "denied" } }) }), select: () => Promise.resolve({ data: null }) }) }),
      userId: () => "u1",
      macDevice: () => "m",
      sign: () => Promise.resolve(""),
      pins: { pinned: () => null },
      syncKeys: t.syncKeys,
      confirm: () => Promise.resolve(true),
      sealOn: () => false,
      keepFor: () => [],
    });
    await expect(failing.drop(W)).rejects.toThrow("The worker's key couldn't be removed: denied");
    expect(await failing.status()).toEqual({ sealOn: false, workers: {} });
  });

  it("reads a damaged list as none", async () => {
    const t = setup();
    fs.mkdirSync(path.dirname(t.api.file), { recursive: true });
    fs.writeFileSync(t.api.file, "not json");
    expect(await t.api.drop(W)).toEqual({ dropped: false });
    fs.writeFileSync(t.api.file, "[]");
    expect(await t.api.drop(W)).toEqual({ dropped: false });
  });
});

describe("registerWorkerKeyGrants", () => {
  it("answers seal, drop and status on the board-only handler", () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const api = { grant: vi.fn(() => "g"), drop: vi.fn(() => "d"), status: vi.fn(() => "s"), regrant: vi.fn(), file: "" };
    registerWorkerKeyGrants((c, fn) => handlers.set(c, fn), api as never);
    expect([...handlers.keys()]).toEqual(["worker-keys:grant", "worker-keys:drop", "worker-keys:status"]);
    expect(handlers.get("worker-keys:grant")!(W)).toBe("g");
    expect(handlers.get("worker-keys:drop")!(undefined)).toBe("d");
    expect(api.drop).toHaveBeenCalledWith("");
    expect(handlers.get("worker-keys:status")!()).toBe("s");
  });
});
