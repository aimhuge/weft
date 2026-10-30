import { beforeEach, describe, expect, it, vi } from "vitest";

// The live view's clicks: a fraction of the screen in, a tap or swipe in the device's own units out. The device,
// touch and watch modules are mocked, so what's pinned is the parsing, the scaling and the refusals.
type Size = { width: number; height: number };
const h = vi.hoisted(() => ({
  watching: true,
  size: undefined as Size | undefined,
  tapAt: vi.fn(() => Promise.resolve()),
  swipe: vi.fn(() => Promise.resolve()),
  markLive: vi.fn(),
}));

const DEV = { id: "SIM-1", name: "iPhone 16", platform: "ios", state: "booted" };
vi.mock("./simulator-devices", () => ({ bootedDevice: vi.fn(() => Promise.resolve(DEV)) }));
vi.mock("./simulator-ui", () => ({ tapAt: h.tapAt, swipe: h.swipe }));
vi.mock("./simulator-watch", () => ({ watching: () => h.watching, watchedSize: () => h.size, markLive: h.markLive }));

const { parseInput, sendInput } = await import("./simulator-input");

beforeEach(() => {
  vi.clearAllMocks();
  h.watching = true;
  h.size = { width: 400, height: 800 };
});

describe("parseInput", () => {
  it("keeps the kind, device and numbers", () => {
    expect(parseInput({ kind: "swipe", device: "SIM-1", x: 0.1, y: 0.2, x2: 0.3, y2: 0.4, ms: 250, extra: "x" })).toEqual({
      kind: "swipe", device: "SIM-1", x: 0.1, y: 0.2, x2: 0.3, y2: 0.4, ms: 250,
    });
  });

  it("drops a field that isn't a number", () => {
    expect(parseInput({ kind: "tap", device: "SIM-1", x: "1" }).x).toBeUndefined();
  });

  it("refuses an unknown kind or a missing device", () => {
    expect(() => parseInput({ kind: "type", device: "SIM-1" })).toThrow(/Unknown input/);
    expect(() => parseInput({ kind: "tap" })).toThrow(/Which device/);
    expect(() => parseInput(null)).toThrow(/Unknown input/);
  });
});

describe("sendInput", () => {
  it("taps at the fraction of the screen, in the device's units", async () => {
    expect(await sendInput({ kind: "tap", device: "SIM-1", x: 0.5, y: 0.25 })).toBe("tap 200,200");
    expect(h.tapAt).toHaveBeenCalledWith(DEV, 200, 200);
  });

  it("clamps a point outside the screen to its edge", async () => {
    await sendInput({ kind: "tap", device: "SIM-1", x: 1.4, y: -0.2 });
    expect(h.tapAt).toHaveBeenCalledWith(DEV, 400, 0);
  });

  it("swipes between two points, with the duration kept in range", async () => {
    await sendInput({ kind: "swipe", device: "SIM-1", x: 0.5, y: 0.75, x2: 0.5, y2: 0.25, ms: 5000 });
    expect(h.swipe).toHaveBeenCalledWith(DEV, { x: 200, y: 600 }, { x: 200, y: 200 }, 1500);
    await sendInput({ kind: "swipe", device: "SIM-1", x: 0, y: 0, x2: 1, y2: 1 });
    expect(h.swipe).toHaveBeenLastCalledWith(DEV, { x: 0, y: 0 }, { x: 400, y: 800 }, 300);
  });

  it("marks the watch live without touching the device", async () => {
    expect(await sendInput({ kind: "live", device: "SIM-1" })).toBe("live");
    expect(h.markLive).toHaveBeenCalledWith("SIM-1");
    expect(h.tapAt).not.toHaveBeenCalled();
  });

  it("refuses a device nobody is watching", async () => {
    h.watching = false;
    await expect(sendInput({ kind: "tap", device: "SIM-1", x: 0.5, y: 0.5 })).rejects.toThrow(/isn't being watched/);
    expect(h.tapAt).not.toHaveBeenCalled();
  });

  it("refuses a tap when the screen size is unknown", async () => {
    h.size = undefined;
    await expect(sendInput({ kind: "tap", device: "SIM-1", x: 0.5, y: 0.5 })).rejects.toThrow(/screen size/);
  });
});
