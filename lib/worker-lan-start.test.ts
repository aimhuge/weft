// Starting the worker's LAN path (lib/worker-lan-start.ts): only on a paired box, and not with WEFT_LAN=0; the hint it
// advertises is signed and checks against the keys the Mac pinned. lib/lan-line.loopback.test.ts runs it end to end.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hintChecks, readHintTxt } from "./lan-hint";
import { macKey, WORKER, workerKeys } from "./lan-hint.harness";
import { seal } from "./worker-seal";

const made = vi.hoisted(() => ({ sockets: [] as { respond: { mock: { calls: unknown[][] } }; destroy: () => void }[] }));
vi.mock("multicast-dns", () => ({
  default: () => {
    const s = { on: vi.fn(), query: vi.fn(), respond: vi.fn(), destroy: vi.fn() };
    made.sockets.push(s);
    return s;
  },
}));

const { lanAddresses, startWorkerLan, startWorkerLanSafely } = await import("./worker-lan-start");

const w = workerKeys();
let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-lan-start-"));
  made.sockets = [];
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const base = () => ({ home, workerId: WORKER, boxKey: w.box.publicKey, sign: w.signer, macKeys: () => ["mac"], open: vi.fn(), log: vi.fn() });

describe("startWorkerLan", () => {
  it("stays off with WEFT_LAN=0, on a box with no sign key, or one that pinned no Mac", async () => {
    for (const o of [{ env: { WEFT_LAN: "0" } }, { sign: undefined, env: {} }, { macKeys: () => [], env: {} }]) {
      const opts = { ...base(), ...o };
      const stop = await startWorkerLan(opts);
      await stop();
      expect(opts.log).toHaveBeenCalledWith(expect.stringMatching(/^Weft Worker: no LAN path \(.+\); boards reach it through Supabase\.$/));
    }
    expect(made.sockets).toHaveLength(0);
    // With no log or env given, still nothing.
    await (await startWorkerLan({ ...base(), log: undefined, sign: undefined }))();
  });

  it("listens on a free port and advertises a signed hint for it on multicast-dns, until stopped", async () => {
    const opts = { ...base(), env: { WEFT_LAN_PORT: "" } };
    const stop = await startWorkerLan(opts);
    const socket = made.sockets[0]!;
    const answers = (socket.respond.mock.calls[0]![0] as { answers: { type: string; name: string; data: unknown }[] }).answers;
    const txt = readHintTxt(answers.find((a) => a.type === "TXT")!.data)!;
    expect(hintChecks(txt, { workerId: WORKER, signKey: w.sign.publicKey, boxKey: w.box.publicKey }, Date.now())).toBe(true);
    expect(answers.find((a) => a.type === "SRV")).toMatchObject({ name: "weft-1a2b3c4d._weft._tcp.local", data: { port: txt.port, target: "weft-1a2b3c4d.local" } });
    expect(opts.log).toHaveBeenCalledWith(`Weft Worker: offering lines on the LAN, port ${txt.port} (_weft._tcp).`);
    await stop();
    expect(socket.destroy).toHaveBeenCalled();
  });
});

describe("startWorkerLanSafely", () => {
  it("reads the Mac keys pinned in this box's home, so a box that pinned none stays off", async () => {
    const log = vi.fn();
    await (await startWorkerLanSafely({ ...base(), log }))();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("wasn't paired with a Mac"));
    fs.writeFileSync(path.join(home, "mac-keys.json"), JSON.stringify(["mac"]));
    const stop = await startWorkerLanSafely({ ...base(), log, env: {} });
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining("offering lines on the LAN"));
    await stop();
  });

  it("refuses an offer signed by a Mac key the box has since marked revoked (mac-revoked.json), from the next offer on", async () => {
    const mac = macKey();
    fs.writeFileSync(path.join(home, "mac-keys.json"), JSON.stringify([mac.raw]));
    fs.writeFileSync(path.join(home, "mac-revoked.json"), JSON.stringify([]));
    const log = vi.fn();
    const open = vi.fn(() => Promise.resolve({ iv: "aXY=", ct: "Y3Q=" }));
    const stop = await startWorkerLanSafely({ ...base(), open, log, env: {} });
    const port = Number(/port (\d+)/.exec(String(log.mock.calls.at(-1)?.[0]))?.[1]);
    const post = () => {
      const sealed = seal(w.box.publicKey, "{}", "rtc-line");
      return fetch(`http://127.0.0.1:${port}/line`, { method: "POST", body: JSON.stringify({ v: 1, workerId: WORKER, sealed, mac: mac.stamp(WORKER, sealed, Date.now()) }) });
    };
    expect((await post()).status).toBe(200);
    fs.writeFileSync(path.join(home, "mac-revoked.json"), JSON.stringify([mac.raw]));
    expect((await post()).status).toBe(403);
    expect(open).toHaveBeenCalledTimes(1);
    await stop();
  });

  it("logs a port it can't take and carries on without the LAN path", async () => {
    fs.writeFileSync(path.join(home, "mac-keys.json"), JSON.stringify(["mac"]));
    const log = vi.fn();
    const stop = await startWorkerLanSafely({ ...base(), log, env: { WEFT_LAN_PORT: "70000" } });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^Weft Worker: no LAN path: .+/));
    await stop();
    await (await startWorkerLanSafely({ ...base(), log: undefined, env: { WEFT_LAN_PORT: "70000" } }))();
  });
});

describe("lanAddresses", () => {
  it("lists this box's external IPv4 addresses", () => {
    const nets = {
      lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      en0: [{ address: "192.168.1.9", family: "IPv4", internal: false }, { address: "fe80::1", family: "IPv6", internal: false }],
      utun: undefined,
    } as unknown as ReturnType<typeof os.networkInterfaces>;
    expect(lanAddresses(nets)).toEqual(["192.168.1.9"]);
    expect(Array.isArray(lanAddresses())).toBe(true);
  });
});
