import { describe, expect, it, vi } from "vitest";
import { macCode, parseMacCode, PREFIX, registerMacPair } from "./mac-pair.cjs";

const KEY = Buffer.alloc(32, 7).toString("base64");
const mac = { device: "d".repeat(64), name: "Studio", signKey: KEY };
const enc = (v: unknown) => PREFIX + Buffer.from(JSON.stringify(v)).toString("base64url");

describe("parseMacCode", () => {
  it("reads back a code, trimmed", () => {
    expect(parseMacCode(`  ${macCode(mac)}\n`)).toEqual(mac);
    expect(parseMacCode(enc({ ...mac, name: "  Studio  " }))).toEqual(mac);
  });

  it("says why a code can't be used", () => {
    const why = (raw: unknown) => parseMacCode(raw);
    expect(why("hello")).toMatch(/isn't a Mac's pairing code/);
    expect(why(undefined)).toMatch(/isn't a Mac's pairing code/);
    expect(why(PREFIX + "%%%")).toMatch(/cut short/);
    expect(why(enc(null))).toMatch(/names no Mac/);
    expect(why(enc({ ...mac, device: "a b" }))).toMatch(/names no Mac/);
    expect(why(enc({ ...mac, device: 3 }))).toMatch(/names no Mac/);
    for (const name of ["", "  ", "x".repeat(61), "bad‮name", "tab\tname", 5]) expect(why(enc({ ...mac, name }))).toMatch(/name can't be shown/);
    expect(why(enc({ ...mac, signKey: "short" }))).toMatch(/no approval key/);
    expect(why(enc({ ...mac, signKey: 1 }))).toMatch(/no approval key/);
  });
});

function setup(over: { confirm?: boolean; own?: string } = {}) {
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const pins = { pin: vi.fn(), list: vi.fn(() => [{ id: "x", name: "Mini", signKey: "k", pairedAt: "t" }]), unpin: vi.fn(() => true) };
  const confirm = vi.fn(() => Promise.resolve(over.confirm ?? true));
  registerMacPair((c: string, fn: (...a: unknown[]) => unknown) => void handlers.set(c, fn), {
    pins: pins as never,
    macDevice: () => over.own ?? "a".repeat(64),
    signKey: () => Promise.resolve(KEY),
    confirm,
    name: () => "Air",
    now: () => 0,
  });
  return { call: (c: string, ...a: unknown[]) => handlers.get(c)?.(...a), pins, confirm };
}

describe("registerMacPair", () => {
  it("gives this Mac's own code", async () => {
    const { call } = setup();
    expect(parseMacCode((await call("mac-pair:code")) as string)).toEqual({ device: "a".repeat(64), name: "Air", signKey: KEY });
  });

  it("pins another Mac's key only after Touch ID, in main's words", async () => {
    const { call, pins, confirm } = setup();
    expect(await call("mac-pair:trust", macCode(mac))).toEqual({ id: mac.device, name: "Studio" });
    expect(confirm).toHaveBeenCalledWith(`let the Mac Studio (dddddddddddddddd) ask this Mac for its uncommitted work`);
    expect(pins.pin).toHaveBeenCalledWith({ id: mac.device, name: "Studio", signKey: KEY, pairedAt: "1970-01-01T00:00:00.000Z" });
  });

  it("pins nothing when Touch ID is refused, the code is bad, or it is this Mac's own", async () => {
    const refused = setup({ confirm: false });
    expect(await refused.call("mac-pair:trust", macCode(mac))).toBeNull();
    expect(refused.pins.pin).not.toHaveBeenCalled();
    await expect(refused.call("mac-pair:trust", "junk")).rejects.toThrow(/isn't a Mac's pairing code/);
    const own = setup({ own: mac.device });
    await expect(own.call("mac-pair:trust", macCode(mac))).rejects.toThrow(/own code/);
    expect(own.confirm).not.toHaveBeenCalled();
  });

  it("lists without keys, and forgets without Touch ID", async () => {
    const { call, pins, confirm } = setup();
    expect(await call("mac-pair:list")).toEqual([{ id: "x", name: "Mini", pairedAt: "t" }]);
    expect(await call("mac-pair:forget", "x")).toBe(true);
    expect(pins.unpin).toHaveBeenCalledWith("x");
    expect(confirm).not.toHaveBeenCalled();
  });
});
