// "Keep on this worker", main's side (electron/worker-keep.cjs, electron/worker-kept.cjs): Touch ID before a value goes,
// sealed to the pinned box key, every command signed with this Mac's key, narrowing without Touch ID, and the worker's
// own kept vault (lib/worker-kept-vault.ts) taking exactly what main sent.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkerKeep, registerWorkerKeep, watchVault } from "./worker-keep.cjs";
import { createKeptRecord, sha, splitKept, withKept } from "./worker-kept.cjs";
import { keptVaultAt } from "../lib/worker-kept-vault";
import { memoryMacs } from "../lib/mac-signer.harness";
import { newSealKeys, open } from "../lib/worker-seal";

const keys = newSealKeys();
const plainStore = () => ({ encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() });
const macPair = crypto.generateKeyPairSync("ed25519");
const macKey = Buffer.from(macPair.publicKey.export({ format: "jwk" }).x as string, "base64url").toString("base64");
const signer = { publicKey: () => macKey, sign: (m: string) => crypto.sign(null, Buffer.from(m), macPair.privateKey).toString("base64") };
const NOW = 5_000_000;
const REPO = "github:o/r";

interface Setup {
  worker?: Record<string, unknown> | null;
  pin?: Record<string, string> | null;
  values?: Record<string, string>;
  answer?: boolean;
  insertError?: { message: string } | null;
  repos?: { id: string; label: string; path: string }[];
}
type Inserted = Record<string, unknown> & { payload: unknown };
type Rec = Record<string, { keeps: Record<string, { envs: unknown }> }>;
const LIVE = { id: "w1", name: "m1mini", org_id: "org-1", owner_user: "u1", public_key: keys.publicKey, revoked_at: null };
function setup({ worker = LIVE, pin = { publicKey: keys.publicKey, signKey: "SK" }, values = { A: "value-a", B: "value-b", NODE_OPTIONS: "--require x" }, answer = true, insertError = null, repos = [{ id: REPO, label: "o/r", path: "/p/r" }] }: Setup = {}) {
  const inserted: Inserted[] = [];
  const db = () => ({
    from: (table: string) => ({
      select: () => {
        const q = { eq: () => q, maybeSingle: () => Promise.resolve({ data: table === "cloud_workers" ? worker : null }) };
        return q;
      },
      insert: (row: Record<string, unknown>) => {
        inserted.push(row as Inserted);
        return Promise.resolve({ error: insertError });
      },
    }),
  });
  const record = createKeptRecord({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "weft-keep-")), safeStorage: plainStore });
  const vault = { valuesFor: vi.fn((_f: string, names: string[] | null) => Promise.resolve({ id: REPO, label: "o/r", values: names ? {} : values })) };
  const confirm = vi.fn(() => Promise.resolve(answer));
  const audit = vi.fn();
  const log = vi.fn();
  let now = NOW;
  const keeper = createWorkerKeep({ record, pins: { pinned: () => pin }, signer, db, userId: () => "u1", vault, repoFolders: () => Promise.resolve(repos), confirm, audit, log, now: () => now });
  return { keeper, record, inserted, vault, confirm, audit, log, tick: (ms: number) => (now += ms) };
}

let worker: ReturnType<typeof keptVaultAt>;
let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-keep-worker-"));
  worker = keptVaultAt(home, "w1", memoryMacs([macKey]), () => NOW);
});

describe("keep", () => {
  it("asks Touch ID, seals each value (no loader variable) to the pinned key, signs it, and the worker takes it", async () => {
    const s = setup();
    expect(await s.keeper.keep({ worker: "w1", repo: REPO, environment: "development" })).toEqual({ kept: ["A", "B"], label: "o/r" });
    expect(s.confirm).toHaveBeenCalledWith("keep 2 development secrets of o/r on the worker m1mini. Any code a thread runs there can read them");
    expect(s.vault.valuesFor).toHaveBeenCalledWith("/p/r", null, "development", false);
    const row = s.inserted[0] as Inserted;
    expect(row).toMatchObject({ org_id: "org-1", kind: "vault_keep", target_device: "worker:w1", folder: "-" });
    expect(JSON.stringify(row)).not.toContain("value-");
    expect(worker.apply(row.payload)).toEqual({ seq: NOW, kept: 2 });
    expect(worker.index(REPO, "development")).toEqual({ A: NOW, B: NOW });
    expect(worker.open(REPO, "development", { A: NOW }, (sealed, purpose) => open(keys, sealed, purpose))).toEqual({ A: "value-a" });
    expect(s.record.read().w1).toEqual({ seq: NOW, keeps: { [REPO]: { label: "o/r", envs: { development: { A: { version: NOW, sha: sha("value-a") }, B: { version: NOW, sha: sha("value-b") } } } } } });
    expect(s.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "keep on worker", names: ["A", "B"], worker: "m1mini" }));
    // A second keep has a newer seq even within the same millisecond.
    await s.keeper.keep({ worker: "w1", repo: REPO, environment: "preview" });
    expect(worker.apply(s.inserted[1]?.payload)).toEqual({ seq: NOW + 1, kept: 2 });
    expect((await s.keeper.list("w1")).kept).toEqual([
      { repo: REPO, label: "o/r", environment: "development", names: ["A", "B"] },
      { repo: REPO, label: "o/r", environment: "preview", names: ["A", "B"] },
    ]);
  });

  it("sends nothing without Touch ID, or with no values", async () => {
    const no = setup({ answer: false });
    expect(await no.keeper.keep({ worker: "w1", repo: REPO, environment: "development" })).toEqual({ denied: true, label: "o/r" });
    expect(no.inserted).toEqual([]);
    const none = setup({ values: { NODE_OPTIONS: "x" } });
    expect(await none.keeper.keep({ worker: "w1", repo: REPO, environment: "development" })).toEqual({ none: true, label: "o/r" });
    expect(none.confirm).not.toHaveBeenCalled();
  });

  it("refuses production, another repo, a worker that isn't the user's, revoked, unpinned or re-keyed", async () => {
    const s = setup();
    await expect(s.keeper.keep({ worker: "w1", repo: REPO, environment: "production" })).rejects.toThrow("production values travel per use");
    await expect(s.keeper.keep({ worker: "w1", repo: "o/r", environment: "development" })).rejects.toThrow("names no GitHub repo");
    await expect(s.keeper.keep()).rejects.toThrow("production values travel per use");
    await expect(s.keeper.keep({ worker: "bad id", repo: REPO, environment: "development" })).rejects.toThrow("That names no worker.");
    await expect(s.keeper.keep({ worker: "w1", repo: "github:x/y", environment: "development" })).rejects.toThrow("no checkout of that repo");
    await expect(setup({ worker: null }).keeper.keep({ worker: "w1", repo: REPO, environment: "development" })).rejects.toThrow("isn't yours");
    await expect(setup({ worker: { id: "w1", name: "m", owner_user: "u2" } }).keeper.keep({ worker: "w1", repo: REPO, environment: "development" })).rejects.toThrow("isn't yours");
    await expect(setup({ worker: { id: "w1", name: "m", owner_user: "u1", revoked_at: "x" } }).keeper.keep({ worker: "w1", repo: REPO, environment: "development" })).rejects.toThrow("was revoked");
    await expect(setup({ pin: null }).keeper.keep({ worker: "w1", repo: REPO, environment: "development" })).rejects.toThrow("no box key pinned");
    await expect(setup({ pin: { publicKey: keys.publicKey } }).keeper.keep({ worker: "w1", repo: REPO, environment: "development" })).rejects.toThrow("no box key pinned");
    await expect(setup({ pin: { publicKey: newSealKeys().publicKey, signKey: "SK" } }).keeper.keep({ worker: "w1", repo: REPO, environment: "development" })).rejects.toThrow("key changed");
    const many = setup({ values: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`K${i}`, "v"])) });
    await expect(many.keeper.keep({ worker: "w1", repo: REPO, environment: "development" })).rejects.toThrow("at most 200");
    const moved = setup();
    moved.vault.valuesFor.mockImplementationOnce(() => Promise.resolve({ id: "github:x/moved", label: "x/moved", values: { A: "v" } }));
    await expect(moved.keeper.keep({ worker: "w1", repo: REPO, environment: "development" })).rejects.toThrow("now names another repo's vault");
    const down = setup({ insertError: { message: "rls" } });
    await expect(down.keeper.keep({ worker: "w1", repo: REPO, environment: "development" })).rejects.toThrow("Couldn't reach m1mini: rls");
    expect(down.record.read()).toEqual({});
  });
});

describe("narrowing", () => {
  it("stop, wipe and a changed secret are signed without Touch ID, and the worker takes them", async () => {
    const s = setup();
    await s.keeper.keep({ worker: "w1", repo: REPO, environment: "development" });
    worker.apply(s.inserted[0]?.payload);
    s.confirm.mockClear();
    await s.keeper.changed(REPO, "A", "development");
    await s.keeper.changed(REPO, "Z", "development");
    expect(worker.apply(s.inserted[1]?.payload)).toEqual({ seq: NOW + 1, kept: 1 });
    expect(s.inserted).toHaveLength(2);
    expect(await s.keeper.stop({ worker: "w1", repo: REPO, environment: "development" })).toEqual({ sent: true, name: "m1mini" });
    worker.apply(s.inserted[2]?.payload);
    expect(worker.count()).toBe(0);
    expect((s.record.read() as Rec).w1?.keeps).toEqual({});
    await s.keeper.wipe("w1");
    expect(worker.apply(s.inserted[3]?.payload)).toEqual({ seq: NOW + 3, kept: 0 });
    expect(s.confirm).not.toHaveBeenCalled();
    expect(() => s.keeper.stop({ worker: "w1", repo: REPO, environment: "production" })).toThrow("That names nothing kept.");
    expect(() => s.keeper.stop()).toThrow("That names nothing kept.");
  });

  it("forgets a revoked worker's copy here without sending (it wipes itself), and logs a change that can't be sent", async () => {
    const s = setup({ worker: { id: "w1", name: "m1mini", owner_user: "u1", revoked_at: "2026-11-03" } });
    s.record.write({ w1: { seq: 1, keeps: { [REPO]: { label: "o/r", envs: { development: { A: { version: 1, sha: "x" } }, preview: { A: { version: 1, sha: "x" } } } } } } });
    expect(await s.keeper.stop({ worker: "w1", repo: REPO, environment: "development" })).toEqual({ sent: false, name: "m1mini" });
    expect((s.record.read() as Rec).w1?.keeps[REPO]?.envs).toEqual({ preview: { A: { version: 1, sha: "x" } } });
    expect(s.inserted).toEqual([]);
    const down = setup({ worker: null });
    down.record.write({ w1: { keeps: { [REPO]: { envs: { development: { A: {} } } } } } });
    await down.keeper.changed(REPO, "A", "development");
    expect(down.log).toHaveBeenCalledWith(expect.stringContaining("taking A off a worker"));
  });
});

describe("splitKept", () => {
  it("keeps only a claimed version of an unchanged value, never one the record doesn't have", () => {
    const record = createKeptRecord({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "weft-split-")), safeStorage: plainStore });
    expect(splitKept(record, "w1", REPO, "development", { A: "va" }, { A: 1 })).toEqual({ values: { A: "va" }, kept: {} });
    record.write({ w1: { keeps: { [REPO]: { envs: { development: { A: { version: 1, sha: sha("va") }, B: { version: "1", sha: sha("vb") }, C: null } } } } } });
    expect(splitKept(record, "w1", REPO, "development", { A: "va", B: "vb", C: "vc" }, { A: 1, B: 1, C: 1 })).toEqual({ values: { B: "vb", C: "vc" }, kept: { A: 1 } });
    expect(splitKept(record, "w1", REPO, "development", { A: "va" }, "junk")).toEqual({ values: { A: "va" }, kept: {} });
    expect(withKept({ v: 1 }, { values: { B: "x" }, kept: {} })).toEqual({ v: 1, values: { B: "x" } });
    expect(withKept({ v: 1 }, { values: {}, kept: { A: 1 } })).toEqual({ v: 1, values: {}, kept: { A: 1 } });
  });

  it("reads a record that won't open, or isn't an object, as nothing kept", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-split-"));
    const record = createKeptRecord({ dir, safeStorage: plainStore });
    fs.mkdirSync(path.join(dir, "vault"), { recursive: true });
    fs.writeFileSync(record.file, Buffer.from("[1]").toString("base64"));
    expect(record.read()).toEqual({});
    record.update("w1", (w) => {
      w.seq = 2;
    });
    expect(record.read()).toEqual({ w1: { seq: 2, keeps: {} } });
    fs.writeFileSync(record.file, Buffer.from(JSON.stringify({ w1: { keeps: [] } })).toString("base64"));
    record.update("w1", () => {});
    expect(record.read()).toEqual({ w1: { keeps: {} } });
  });
});

describe("watchVault", () => {
  it("tells the keeper when a value is saved or removed, and only then", async () => {
    const changed = vi.fn<(repo: string, name: string, environment: string) => Promise<void>>(() => Promise.resolve());
    const vault = {
      setValue: vi.fn((...args: unknown[]) => Promise.resolve(args[1] === "LOST" ? { saved: false } : { saved: true })),
      remove: vi.fn<(id: string, name: string, environment: string) => Promise<{ removed: boolean }>>(() => Promise.resolve({ removed: true })),
      valuesFor: vi.fn(() => Promise.resolve({ id: REPO })),
    };
    watchVault(vault, changed);
    expect(await vault.setValue("/p/r", "A", "development", "v")).toEqual({ saved: true });
    expect(changed).toHaveBeenCalledWith(REPO, "A", "development");
    await vault.setValue("/p/r", "LOST", "development", "v");
    expect(changed).toHaveBeenCalledTimes(1);
    vault.valuesFor.mockImplementationOnce(() => Promise.reject(new Error("no vault")));
    await vault.setValue("/p/r", "B", "development", "v");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(await vault.remove(REPO, "A", "preview")).toEqual({ removed: true });
    expect(changed).toHaveBeenLastCalledWith(REPO, "A", "preview");
  });
});

describe("registerWorkerKeep", () => {
  it("answers the board's four calls", () => {
    const handlers: Record<string, (...args: unknown[]) => unknown> = {};
    const keeper = { list: vi.fn(), keep: vi.fn(), stop: vi.fn(), wipe: vi.fn() };
    registerWorkerKeep((channel: string, fn: (...args: unknown[]) => unknown) => (handlers[channel] = fn), keeper);
    handlers["worker-keep:list"]?.(5);
    handlers["worker-keep:keep"]?.({ worker: "w" });
    handlers["worker-keep:keep"]?.(null);
    handlers["worker-keep:stop"]?.("x");
    handlers["worker-keep:wipe"]?.("w1");
    expect(keeper.list).toHaveBeenCalledWith("5");
    expect(keeper.keep.mock.calls).toEqual([[{ worker: "w" }], [{}]]);
    expect(keeper.stop).toHaveBeenCalledWith({});
    expect(keeper.wipe).toHaveBeenCalledWith("w1");
  });
});
