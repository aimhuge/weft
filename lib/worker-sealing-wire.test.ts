import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { grantKit, newSyncKey, ORG, WORKER } from "./worker-key-grant.harness";
import { macKeysAt } from "./worker-mac-keys";
import { startWorkerSealing } from "./worker-sealing-wire";
import type { WakeHooks } from "./worker-wake";

describe("startWorkerSealing", () => {
  it("reads its grants through worker_key_grants before the daemon starts, again on a ping, and checks them against the Mac it pinned", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-sealing-wire-"));
    const kit = grantKit();
    macKeysAt(home).pin(kit.mac.key);
    let rows: unknown[] = [];
    const rpc = vi.fn(() => Promise.resolve({ data: rows, error: null }));
    let hooks: WakeHooks | null = null;
    const leave = vi.fn();
    const config = { workerId: WORKER, orgId: ORG, key: "wwk_x" };
    const wired = await startWorkerSealing({ home, config, rpc, keys: kit.keys, isShared: () => false, readBlob: () => Promise.resolve(null), listen: (h) => ((hooks = h), leave), log: vi.fn() });
    expect(rpc).toHaveBeenCalledWith("worker_key_grants", { p_key: "wwk_x" });
    expect(wired.sealer()).toBeNull();
    rows = [kit.make(1, newSyncKey())];
    hooks!.ping();
    await vi.waitFor(() => expect(wired.ring.current()?.version).toBe(1));
    expect(wired.sealer()).not.toBeNull();
    hooks!.down();
    hooks!.up();
    expect(await wired.reader("nope")).toBeNull();
    wired.stop();
    expect(leave).toHaveBeenCalled();
  });

  it("takes no grant on a box that trusts no Mac, and keeps going when the lookup fails", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-sealing-wire-"));
    const kit = grantKit();
    const log = vi.fn();
    const rpc = vi.fn().mockResolvedValueOnce({ data: [kit.make(1)], error: null }).mockResolvedValueOnce({ data: null, error: { message: "no such function" } }).mockResolvedValue({ data: "odd", error: null });
    const wired = await startWorkerSealing({ home, config: { workerId: WORKER, orgId: ORG, key: "k" }, rpc, keys: kit.keys, isShared: () => false, readBlob: () => Promise.resolve(null), log });
    expect(wired.ring.current()).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/trusts no Mac/));
    await wired.ring.refresh();
    expect(log).toHaveBeenCalledWith("Weft Worker: reading its key grants: no such function");
    await wired.ring.refresh();
    expect(wired.ring.ring().size).toBe(0);
    wired.stop();
  });

  it("refuses a grant from a pairing Mac that was revoked since, and then holds rather than going plain", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-sealing-wire-"));
    const kit = grantKit();
    const macs = macKeysAt(home);
    macs.pin(kit.mac.key);
    const log = vi.fn();
    const rpc = vi.fn(() => Promise.resolve({ data: [kit.make(1)], error: null }));
    const wired = await startWorkerSealing({ home, config: { workerId: WORKER, orgId: ORG, key: "k" }, rpc, keys: kit.keys, isShared: () => false, readBlob: () => Promise.resolve(null), log });
    expect(wired.ring.current()?.version).toBe(1);
    // lib/worker-mac-revocation.ts marks it in mac-revoked.json: pinned() leaves it out, so its signature counts for nothing.
    macs.revoke([kit.mac.key]);
    expect(macs.held()).toEqual([kit.mac.key]);
    await wired.ring.refresh();
    expect(wired.ring.current()).toBeNull();
    expect(wired.sealer()).toBe("hold");
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/refused a key grant \(v1\): this box trusts no Mac/));
    wired.stop();
  });
});
