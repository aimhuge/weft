import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { grantKit, newSyncKey } from "./worker-key-grant.harness";
import { createWorkerKeyring, sealFloorAt } from "./worker-keyring";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "weft-keyring-")), "home");

function ringFor(rows: () => Promise<unknown[]>, home = tmp(), kit = grantKit()) {
  const log = vi.fn();
  const ring = createWorkerKeyring({ read: rows, context: () => kit.ctx(), floor: sealFloorAt(home), log });
  return { ring, log, kit, home };
}

describe("sealFloorAt", () => {
  it("marks a box that has sealed, once, mode 600, naming no key", () => {
    const home = tmp();
    const floor = sealFloorAt(home);
    expect(floor.held()).toBe(false);
    floor.set();
    floor.set();
    expect(floor.held()).toBe(true);
    const file = path.join(home, "seal-floor.json");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ seals: true });
  });
});

describe("createWorkerKeyring", () => {
  it("publishes plain with no grant and no floor, then seals with the newest grant it accepts", async () => {
    const kit = grantKit();
    const k1 = newSyncKey();
    const k2 = newSyncKey();
    let rows: unknown[] = [];
    const { ring, log, home } = ringFor(() => Promise.resolve(rows), tmp(), kit);
    await ring.refresh();
    expect(ring.state()).toBe("plain");
    expect(ring.current()).toBeNull();
    rows = [kit.make(1, k1), kit.make(2, k2)];
    await ring.refresh();
    expect(ring.state()).toEqual({ key: { version: 2, key: k2 } });
    expect([...ring.ring()]).toEqual([[1, k1], [2, k2]]);
    expect(log).toHaveBeenCalledWith("Weft Worker: sealing its threads with workspace key v2");
    expect(sealFloorAt(home).held()).toBe(true);
  });

  it("drops a grant the Mac took back, and then holds rather than going plain", async () => {
    const kit = grantKit();
    let rows: unknown[] = [kit.make(1)];
    const { ring, log } = ringFor(() => Promise.resolve(rows), tmp(), kit);
    await ring.refresh();
    rows = [];
    await ring.refresh();
    expect(ring.ring().size).toBe(0);
    expect(ring.state()).toBe("hold");
    expect(log).toHaveBeenCalledWith("Weft Worker: holds no workspace key now");
  });

  it("keeps the ring it had when a read fails, and says why once", async () => {
    const kit = grantKit();
    let fail = false;
    const { ring, log } = ringFor(() => (fail ? Promise.reject(new Error("offline")) : Promise.resolve([kit.make(1)])), tmp(), kit);
    await ring.refresh();
    fail = true;
    await ring.refresh();
    await ring.refresh();
    expect(ring.current()?.version).toBe(1);
    expect(log.mock.calls.filter(([m]) => String(m).includes("offline"))).toHaveLength(1);
  });

  it("refuses a planted grant, saying so once", async () => {
    const kit = grantKit();
    const planted = grantKit(kit.keys);
    const { ring, log } = ringFor(() => Promise.resolve([planted.make(5), { version: "x" }, null]), tmp(), kit);
    await ring.refresh();
    await ring.refresh();
    expect(ring.ring().size).toBe(0);
    expect(log.mock.calls.filter(([m]) => String(m).includes("v5"))).toHaveLength(1);
    expect(log).toHaveBeenCalledWith("Weft Worker: refused a key grant (vx): it isn't a key grant");
    expect(log).toHaveBeenCalledWith("Weft Worker: refused a key grant (v?): it isn't a key grant");
  });

  it("reads again on a timer until stopped", async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(() => Promise.resolve([]));
      const { ring } = ringFor(read);
      const stop = ring.start(1000);
      await vi.advanceTimersByTimeAsync(2500);
      expect(read).toHaveBeenCalledTimes(2);
      stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(read).toHaveBeenCalledTimes(2);
      ring.start();
    } finally {
      vi.useRealTimers();
    }
  });
});
