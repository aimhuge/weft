// Synced folders in main (electron/tree-sync-sign.cjs): the sealed list of folders you turned sync on for with Touch ID,
// and this Mac's signature on each `tree` channel's open, only for a paired worker and a folder on the list.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openMessage as tsMessage } from "../lib/tree-sync-proof";
import { openMessage, syncList, treeSyncRoutes } from "./tree-sync-sign.cjs";

const WORKER = "1a2b3c4d-0000-4000-8000-00000000abcd";
const OTHER = "1a2b3c4d-0000-4000-8000-000000000001";
type Route = (body: unknown) => Promise<Record<string, unknown>> | Record<string, unknown>;

const safe = () => ({ encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() });
const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "weft-tree-sync-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
});

const pinsOf = (pins: Record<string, { signKey?: string }>) => () => ({ pinned: (id: string) => pins[id] ?? null });

function setup({ ask = (): Promise<boolean> => Promise.resolve(true), pins = { [WORKER]: { signKey: "sign" } } }: { ask?: () => Promise<boolean>; pins?: Record<string, { signKey?: string }> } = {}) {
  const dir = tmp();
  const list = syncList({ dir, safeStorage: safe });
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const key = {
    publicKey: () => publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    sign: (m: string) => crypto.sign(null, Buffer.from(m), privateKey).toString("base64"),
  };
  const signer = vi.fn(() => Promise.resolve(key));
  const askSpy = vi.fn(ask);
  const routes = treeSyncRoutes({ list, pins: pinsOf(pins), signer, ask: askSpy, now: () => 1_000 }) as Record<"POST /tree-sync/list" | "POST /tree-sync/enable" | "POST /tree-sync/disable" | "POST /tree-sync/sign", Route>;
  return { dir, list, routes, signer, ask: askSpy, publicKey };
}

describe("openMessage", () => {
  it("matches lib/tree-sync-proof.ts", () => {
    expect(openMessage(WORKER.toUpperCase(), "weft", 12, "n")).toBe(tsMessage(WORKER.toUpperCase(), "weft", 12, "n"));
  });
});

describe("syncList", () => {
  it("is empty with no file, seals what it writes, and replaces a folder already on it", () => {
    const { dir, list } = setup();
    expect(list.list()).toEqual([]);
    list.add({ workerId: WORKER, folder: "weft" }, "a");
    list.add({ workerId: WORKER, folder: "weft" }, "b");
    list.add({ workerId: WORKER, folder: "ling" }, "c");
    expect(list.list()).toEqual([{ workerId: WORKER, folder: "weft", at: "b" }, { workerId: WORKER, folder: "ling", at: "c" }]);
    expect(list.has({ workerId: WORKER, folder: "ling" })).toBe(true);
    list.remove({ workerId: WORKER, folder: "ling" });
    expect(list.has({ workerId: WORKER, folder: "ling" })).toBe(false);
    const raw = fs.readFileSync(path.join(dir, "vault", "tree-sync.json"), "utf8");
    expect(JSON.parse(Buffer.from(raw, "base64").toString())).toEqual({ folders: [{ workerId: WORKER, folder: "weft", at: "b" }] });
  });

  it("is empty when the file can't be read or holds no list", () => {
    const { dir, list } = setup();
    fs.mkdirSync(path.join(dir, "vault"), { recursive: true });
    fs.writeFileSync(path.join(dir, "vault", "tree-sync.json"), "!!!");
    expect(list.list()).toEqual([]);
    fs.writeFileSync(path.join(dir, "vault", "tree-sync.json"), Buffer.from(JSON.stringify({ folders: 1 })).toString("base64"));
    expect(list.list()).toEqual([]);
  });
});

describe("POST /tree-sync/enable, /disable and /list", () => {
  it("adds a folder after Touch ID, lists it without its time, and removes it", async () => {
    const { routes, ask } = setup();
    expect(await routes["POST /tree-sync/enable"]({ workerId: WORKER.toUpperCase(), folder: "weft", workerName: "Mini" })).toEqual({ ok: true });
    expect(ask).toHaveBeenCalledWith("keep weft in sync with Mini, so each can change the other's files");
    expect(await routes["POST /tree-sync/list"]({})).toEqual({ folders: [{ workerId: WORKER, folder: "weft" }] });
    await routes["POST /tree-sync/enable"]({ workerId: WORKER, folder: "ling" });
    expect(ask).toHaveBeenLastCalledWith("keep ling in sync with your worker, so each can change the other's files");
    expect(await routes["POST /tree-sync/disable"]({ workerId: WORKER, folder: "weft" })).toEqual({ ok: true });
    expect(await routes["POST /tree-sync/list"]({})).toEqual({ folders: [{ workerId: WORKER, folder: "ling" }] });
  });

  it("refuses a worker this Mac didn't pair, and a declined Touch ID, before writing", async () => {
    const { routes, ask, list } = setup({ ask: () => Promise.resolve(false), pins: { [WORKER]: { signKey: "s" }, [OTHER]: {} } });
    await expect(routes["POST /tree-sync/enable"]({ workerId: OTHER, folder: "weft" })).rejects.toThrow("didn't pair that worker");
    expect(ask).not.toHaveBeenCalled();
    await expect(routes["POST /tree-sync/enable"]({ workerId: WORKER, folder: "weft" })).rejects.toThrow("wasn't turned on");
    expect(list.list()).toEqual([]);
  });

  it("refuses a bad worker or folder", () => {
    const { routes } = setup();
    expect(() => routes["POST /tree-sync/disable"]({ workerId: "w1", folder: "weft" })).toThrow("names no worker");
    expect(() => routes["POST /tree-sync/disable"](null)).toThrow("names no worker");
    expect(() => routes["POST /tree-sync/disable"]({ workerId: WORKER, folder: "a/b" })).toThrow("names no project");
    expect(() => routes["POST /tree-sync/disable"]({ workerId: WORKER, folder: ".git" })).toThrow("names no project");
    expect(() => routes["POST /tree-sync/disable"]({ workerId: WORKER })).toThrow("names no project");
  });
});

describe("POST /tree-sync/sign", () => {
  it("signs the open with this Mac's key, for a synced folder on a paired worker", async () => {
    const { routes, publicKey } = setup();
    await routes["POST /tree-sync/enable"]({ workerId: WORKER, folder: "weft" });
    const stamp = (await routes["POST /tree-sync/sign"]({ workerId: WORKER.toUpperCase(), folder: "weft" })) as { key: string; sig: string; issuedAt: number; nonce: string };
    expect(stamp.issuedAt).toBe(1_000);
    expect(stamp.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(stamp.key).toBe(publicKey.export({ format: "der", type: "spki" }).toString("base64"));
    const ok = crypto.verify(null, Buffer.from(tsMessage(WORKER, "weft", 1_000, stamp.nonce)), publicKey, Buffer.from(stamp.sig, "base64"));
    expect(ok).toBe(true);
    const again = (await routes["POST /tree-sync/sign"]({ workerId: WORKER, folder: "weft" })) as { nonce: string };
    expect(again.nonce).not.toBe(stamp.nonce);
  });

  it("signs nothing for an unpaired worker or a folder sync isn't on for", async () => {
    const { routes, signer } = setup({ pins: { [WORKER]: { signKey: "s" } } });
    await expect(routes["POST /tree-sync/sign"]({ workerId: OTHER, folder: "weft" })).rejects.toThrow("didn't pair that worker");
    await expect(routes["POST /tree-sync/sign"]({ workerId: WORKER, folder: "weft" })).rejects.toThrow("Sync isn't on for weft.");
    await expect(routes["POST /tree-sync/sign"]({ workerId: "x", folder: "weft" })).rejects.toThrow("names no worker");
    expect(signer).not.toHaveBeenCalled();
  });

  it("uses the clock when none is given", async () => {
    const list = syncList({ dir: tmp(), safeStorage: safe });
    list.add({ workerId: WORKER, folder: "weft" }, "a");
    const routes = treeSyncRoutes({ list, pins: pinsOf({ [WORKER]: { signKey: "s" } }), signer: () => Promise.resolve({ publicKey: () => "k", sign: () => "s" }), ask: () => Promise.resolve(true) }) as Record<"POST /tree-sync/list" | "POST /tree-sync/enable" | "POST /tree-sync/disable" | "POST /tree-sync/sign", Route>;
    const before = Date.now();
    expect(((await routes["POST /tree-sync/sign"]({ workerId: WORKER, folder: "weft" })) as { issuedAt: number }).issuedAt).toBeGreaterThanOrEqual(before);
  });
});
