import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Device } from "./simulator-devices";

const idb = vi.hoisted(() => ({ openIdb: vi.fn() }));
const rtc = vi.hoisted(() => ({ answerOffer: vi.fn() }));
vi.mock("./idb-companion", () => idb);
vi.mock("./worker-rtc", () => rtc);

const { isKeyFrame, openFastScreen } = await import("./worker-fast-screen");

const ios: Device = { id: "u", name: "iPhone", platform: "ios", state: "booted" };
const session = () => ({ size: { width: 1, height: 2 }, video: vi.fn(), touch: vi.fn(), key: vi.fn(), close: vi.fn() });

beforeEach(() => vi.clearAllMocks());

describe("isKeyFrame", () => {
  it("finds an IDR slice after any start code", () => {
    expect(isKeyFrame(Buffer.from([0, 0, 0, 1, 0x67, 0, 0, 1, 0x65]))).toBe(true);
    expect(isKeyFrame(Buffer.from([0, 0, 1, 0x41, 3]))).toBe(false);
  });
});

describe("openFastScreen", () => {
  it("leaves Android on the JPEG path", async () => {
    await expect(openFastScreen({ ...ios, platform: "android" })).resolves.toBeNull();
    expect(idb.openIdb).not.toHaveBeenCalled();
  });

  it("leaves a box with no companion on the JPEG path", async () => {
    idb.openIdb.mockResolvedValue(null);
    await expect(openFastScreen(ios)).resolves.toBeNull();
  });

  it("answers an offer with the video and input channels, and a new offer replaces the line", async () => {
    const s = session();
    idb.openIdb.mockResolvedValue(s);
    const first = { answer: "a1", close: vi.fn() };
    rtc.answerOffer.mockResolvedValueOnce(first).mockResolvedValueOnce({ answer: "a2", close: vi.fn() });
    const fast = await openFastScreen(ios);
    await expect(fast?.connect("o1")).resolves.toBe("a1");
    expect(Object.keys(rtc.answerOffer.mock.calls[0]?.[1] as object)).toEqual(["video", "input"]);
    await expect(fast?.connect("o2")).resolves.toBe("a2");
    expect(first.close).toHaveBeenCalled();
  });

  it("closes the line and the session together", async () => {
    const s = session();
    idb.openIdb.mockResolvedValue(s);
    const line = { answer: "a", close: vi.fn() };
    rtc.answerOffer.mockResolvedValue(line);
    const fast = await openFastScreen(ios);
    await fast?.connect("o");
    fast?.close();
    expect(line.close).toHaveBeenCalled();
    expect(s.close).toHaveBeenCalled();
  });
});
