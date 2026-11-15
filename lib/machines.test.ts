import { describe, expect, it } from "vitest";
import type { DeviceView } from "./device-registry";
import { machineName, machinesOf, type Machine } from "./machines";

const d = (over: Partial<DeviceView>): DeviceView => ({
  id: "i", kind: "mac", name: "n", platform: "", orgId: null, host: null, hasBoxKey: false, hasSignKey: false, hasPasskey: false, approves: false,
  fingerprint: null, status: null, lastSeenAt: null, revokedAt: null, note: null, build: null, here: false, threads: 0, ...over,
});

describe("machineName", () => {
  it("strips the prefix and .local, lowercases", () => {
    expect(machineName("Weft on MacBook-Air-3.LOCAL")).toBe("macbook-air-3");
    expect(machineName("m1mini")).toBe("m1mini");
  });
});

describe("machinesOf", () => {
  it("folds a heartbeat row and a key row into one machine", () => {
    const hb = d({ id: "a", host: "a", name: "MacBook-Air-3", status: "online", here: true });
    const key = d({ id: "k", name: "Weft on MacBook-Air-3.local" });
    const [m, ...rest] = machinesOf([key, hb]);
    expect(rest).toEqual([]);
    expect(m).toMatchObject({ key: "host:a", name: "MacBook-Air-3", here: true, online: true, mac: hb, others: [key], revoked: [] });
    // Whichever row comes first, the shorter name wins.
    expect(machinesOf([hb, key])[0]).toMatchObject({ name: "MacBook-Air-3" });
  });

  it("joins a worker to the desktop on the same box", () => {
    const mac = d({ id: "a", host: "a", name: "Weft on m1mini", status: "offline" });
    const w = d({ id: "w", kind: "worker", name: "m1mini", status: "busy", host: "worker:w" });
    const [m, ...rest] = machinesOf([w, mac]);
    expect(rest).toEqual([]);
    expect(m).toMatchObject({ name: "m1mini", mac, worker: w, online: true });
  });

  it("keeps a lone worker, a lone key row, phones and browsers apart", () => {
    const ms = machinesOf([
      d({ id: "w", kind: "worker", name: "box" }),
      d({ id: "k", name: "Weft on lone.local" }),
      d({ id: "p", kind: "phone", name: "iPhone" }),
      d({ id: "b", kind: "browser", name: "Chrome", revokedAt: "t" }),
    ]);
    expect(ms.map((m) => m.key).sort()).toEqual(["b", "mac:k", "p", "worker:w"]);
    expect(ms.find((m) => m.key === "p")?.others).toHaveLength(1);
    expect(ms.find((m) => m.key === "b")?.revoked).toHaveLength(1);
  });

  it("puts revoked rows aside and never lets them set online or here", () => {
    const live = d({ id: "a", host: "a", name: "Weft on x", status: "offline" });
    const dead = d({ id: "o", host: "o", name: "x", status: "online", here: true, revokedAt: "t" });
    const dead2 = d({ id: "z", kind: "worker", name: "x", revokedAt: "t" });
    const ms = machinesOf([live, dead, dead2]);
    const m = ms.find((x) => x.key === "host:a");
    expect(m).toMatchObject({ here: false, online: false, mac: live });
    expect(m?.revoked).toEqual([dead2]);
    const only = ms.find((x) => x.key === "host:o");
    expect(only).toMatchObject({ mac: undefined, worker: undefined, online: false, here: false, name: "x" });
  });

  it("prefers a Mac row with a host, and extra live rows go to others", () => {
    const keyA = d({ id: "k1", name: "Weft on box" });
    const keyB = d({ id: "k2", name: "Weft on box.local" });
    const hb = d({ id: "h", host: "h", name: "box" });
    const [m] = machinesOf([keyA, keyB, hb]) as [Machine];
    expect(m.mac).toBe(hb);
    expect(m.others).toEqual([keyA, keyB]);
    const [only] = machinesOf([keyA]) as [Machine];
    expect(only.mac).toBe(keyA);
  });

  it("orders here, then online, then name", () => {
    const ms = machinesOf([
      d({ id: "1", host: "1", name: "b" }),
      d({ id: "2", host: "2", name: "a" }),
      d({ id: "3", host: "3", name: "c", status: "online" }),
      d({ id: "4", host: "4", name: "z", here: true }),
    ]);
    expect(ms.map((m) => m.name)).toEqual(["z", "c", "a", "b"]);
  });
});
