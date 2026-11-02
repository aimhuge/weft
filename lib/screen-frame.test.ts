import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { Device } from "./simulator-devices";

const devices = vi.hoisted(() => ({ screenshot: vi.fn() }));
vi.mock("./simulator-devices", () => devices);

const { encodeFrame, frameType, screenFrame, FRAME_WIDTH } = await import("./screen-frame");

const png = (width: number) => sharp({ create: { width, height: width * 2, channels: 3, background: "#336699" } }).png().toBuffer();
const d: Device = { id: "udid-1", name: "iPhone 17", platform: "ios", state: "booted" };

describe("frameType", () => {
  it("sends WebP where sharp writes it, and JPEG where it can't or is told to", () => {
    expect(frameType({}, { webp: { output: { buffer: true } } })).toBe("webp");
    expect(frameType({}, { webp: { output: { buffer: false } } })).toBe("jpeg");
    expect(frameType({}, {})).toBe("jpeg");
    expect(frameType({ WEFT_SCREEN_FORMAT: "jpeg" }, { webp: { output: { buffer: true } } })).toBe("jpeg");
  });

  it("finds WebP in this box's own sharp", () => {
    expect(frameType({})).toBe("webp");
  });
});

describe("encodeFrame", () => {
  it("writes WebP or JPEG, never wider than the frame width", async () => {
    const webp = await encodeFrame(await png(FRAME_WIDTH * 2), "webp");
    expect(webp.type).toBe("webp");
    expect(await sharp(webp.bytes).metadata()).toMatchObject({ format: "webp", width: FRAME_WIDTH });
    const jpeg = await encodeFrame(await png(8), "jpeg");
    expect(await sharp(jpeg.bytes).metadata()).toMatchObject({ format: "jpeg", width: 8 });
  });
});

describe("screenFrame", () => {
  it("captures the device and encodes it", async () => {
    devices.screenshot.mockResolvedValue(await png(8));
    const frame = await screenFrame(d, "jpeg");
    expect(devices.screenshot).toHaveBeenCalledWith(d);
    expect(frame.type).toBe("jpeg");
    expect((await screenFrame(d, "webp")).type).toBe("webp");
  });
});
