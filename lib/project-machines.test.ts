import { describe, expect, it } from "vitest";
import type { DeviceView } from "./device-registry";
import { HERE, menuMachines, type MachinesInput } from "./project-machines";

const W = "0f8c2a1e-7b3d-4c5e-9a6f-1b2c3d4e5f60";
const AIR = "a".repeat(64);
const MINI = "b".repeat(64);

function device(over: Partial<DeviceView>): DeviceView {
  return {
    id: "id", kind: "mac", name: "Mac", platform: "darwin", orgId: "o", host: null, hasBoxKey: false, hasSignKey: false, hasPasskey: false,
    approves: false, fingerprint: null, status: "online", lastSeenAt: null, revokedAt: null, note: null, build: null, here: false, threads: 0, ...over,
  };
}

const air = device({ id: "air", name: "MacBook-Air-3", host: AIR });
const airKey = device({ id: "air-key", name: "Weft on MacBook-Air-3.local" });
const miniMac = device({ id: "mini", name: "Weft on m1mini", host: MINI });
const miniWorker = device({ id: W, kind: "worker", name: "m1mini", host: `worker:${W}` });
const twin = { path: `worker://${W}/weft`, name: "m1mini", offline: false };

const input = (over: Partial<MachinesInput>): MachinesInput => ({ name: "weft", synced: true, devices: [], workerTwins: [], syncTwins: [], onWorker: false, ...over });

describe("menuMachines", () => {
  it("is one group per box: the worker's pull, sync and the tick for m1mini, the signed ask for the Air", () => {
    const here = device({ id: "me", name: "Weft on studio", host: "c".repeat(64), here: true });
    expect(menuMachines(input({ devices: [here, air, airKey, miniMac, miniWorker], workerTwins: [twin], syncTwins: [{ ...twin, on: true }], onWorker: true }))).toEqual([
      { name: "m1mini", offline: false, pull: twin.path, sync: { path: twin.path, on: true }, runThere: true },
      { name: "MacBook-Air-3", offline: false, pull: `mac:${AIR}/weft` },
    ]);
  });

  it("asks the box's Mac when its worker is offline, and the worker anyway when there's no Mac to ask", () => {
    const down = { ...twin, offline: true };
    expect(menuMachines(input({ devices: [miniMac, miniWorker], workerTwins: [down] }))[0]).toMatchObject({ pull: `mac:${MINI}/weft` });
    expect(menuMachines(input({ devices: [miniWorker], workerTwins: [down] }))[0]).toMatchObject({ pull: twin.path });
    // A project that doesn't sync has no Mac to ask.
    expect(menuMachines(input({ synced: false, devices: [miniMac, miniWorker], workerTwins: [down] }))[0]).toMatchObject({ pull: twin.path });
  });

  it("matches a worker by its address too, and shows a machine as offline when nothing of it is up", () => {
    const row = device({ id: "row", kind: "worker", name: "m1mini", host: `worker:${W.toUpperCase()}`, status: "offline" });
    expect(menuMachines(input({ devices: [row], workerTwins: [twin] }))).toEqual([{ name: "m1mini", offline: true, pull: twin.path, runThere: false }]);
  });

  it("leaves out a machine with nothing to offer, and puts no tick when two workers could take the threads", () => {
    const other = device({ id: "w2", kind: "worker", name: "box", host: "worker:w2" });
    expect(menuMachines(input({ synced: false, devices: [air] }))).toEqual([]);
    expect(menuMachines(input({ devices: [miniWorker, other], workerTwins: [twin] }))).toEqual([{ name: "m1mini", offline: false, pull: twin.path }]);
  });

  it("names the worker on this same Mac, which never asks itself", () => {
    const me = device({ id: "mini", name: "Weft on m1mini", host: MINI, here: true });
    expect(menuMachines(input({ devices: [me, miniWorker], workerTwins: [{ ...twin, offline: true }] }))).toEqual([{ name: HERE, offline: true, pull: twin.path, runThere: false }]);
    // With no worker beside it, this Mac isn't in its own menu.
    expect(menuMachines(input({ devices: [me] }))).toEqual([]);
  });

  it("doesn't take a worker row with no address for a twin it has a different id from", () => {
    const bare = device({ id: "other", kind: "worker", name: "box", host: null });
    expect(menuMachines(input({ devices: [bare], workerTwins: [twin] }))).toEqual([
      { name: "box", offline: false, runThere: false },
      { name: "m1mini", offline: false, pull: twin.path },
    ]);
  });

  it("keeps a worker twin the registry didn't list, synced or not", () => {
    expect(menuMachines(input({ workerTwins: [twin] }))).toEqual([{ name: "m1mini", offline: false, pull: twin.path }]);
    expect(menuMachines(input({ workerTwins: [twin], syncTwins: [{ ...twin, on: false }] }))).toEqual([{ name: "m1mini", offline: false, pull: twin.path, sync: { path: twin.path, on: false } }]);
    expect(menuMachines(input({ workerTwins: [{ path: "not-a-worker", name: "x", offline: false }], devices: [miniWorker] }))).toHaveLength(2);
  });
});
