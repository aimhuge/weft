// lib/app-card-image.tsx: a shared mini app's branded link-preview card. next/og and the font files are stubbed, so the
// test reads the element tree the card hands to ImageResponse rather than rendering pixels.
import { describe, expect, it, vi } from "vitest";

const seen: { element: unknown; options: unknown } = vi.hoisted(() => ({ element: null, options: null }));

vi.mock("next/og", () => ({
  ImageResponse: vi.fn(function (element: unknown, options: unknown) {
    seen.element = element;
    seen.options = options;
  }),
}));
vi.mock("node:fs/promises", () => ({ readFile: vi.fn().mockResolvedValue(Buffer.from("file-bytes")) }));

import { APP_CARD_SIZE, appCardImage, cardTitle, imageDataUrl, imageType } from "./app-card-image";

function bytes(...values: number[]): ArrayBuffer {
  const out = new Uint8Array(12);
  out.set(values);
  return out.buffer;
}

// The inset capture is the one element whose only prop is its picture (the emblem's img has an alt and a size too).
const CAPTURE = /"props":\{"src":"[^"]*"\}/;
const PNG = bytes(0x89, 0x50, 0x4e, 0x47);
const JPEG = bytes(0xff, 0xd8, 0xff);
const GIF = bytes(0x47, 0x49, 0x46);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);

describe("imageType", () => {
  it("names PNG, JPEG, GIF and WebP by their first bytes", () => {
    expect(imageType(PNG)).toBe("image/png");
    expect(imageType(JPEG)).toBe("image/jpeg");
    expect(imageType(GIF)).toBe("image/gif");
    expect(imageType(WEBP)).toBe("image/webp");
  });

  it("is null for anything else, including a RIFF that isn't WebP", () => {
    expect(imageType(bytes(0x3c, 0x73, 0x76, 0x67))).toBeNull();
    expect(imageType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20))).toBeNull();
    expect(imageType(new ArrayBuffer(0))).toBeNull();
  });
});

describe("imageDataUrl", () => {
  it("is a data url of the sniffed type", () => {
    expect(imageDataUrl(JPEG)).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("falls back to png for bytes it doesn't know", () => {
    expect(imageDataUrl(bytes(1, 2, 3))).toMatch(/^data:image\/png;base64,/);
  });
});

describe("cardTitle", () => {
  it("drops the emoji the name starts with, which the tile draws", () => {
    expect(cardTitle({ name: "📈 Growth" })).toBe("Growth");
  });

  it("keeps a plain name, and a title the page set, as they are", () => {
    expect(cardTitle({ name: "Launch checklist" })).toBe("Launch checklist");
    expect(cardTitle({ name: "📈 Growth", title: "Weekly growth" })).toBe("Weekly growth");
  });

  it("keeps the whole title when the emoji is all there is", () => {
    expect(cardTitle({ name: "📈" })).toBe("📈");
  });

  it("strips the emoji from a title that repeats it", () => {
    expect(cardTitle({ name: "📈 Growth", title: "📈 Growth board" })).toBe("Growth board");
  });
});

describe("appCardImage", () => {
  const text = () => JSON.stringify(seen.element);

  it("draws the title, description and byline at 1200x630 with the font", async () => {
    await appCardImage({ name: "📈 Growth", description: "Signups by week.", byline: "@fotoflo" });
    expect(text()).toContain("Growth");
    expect(text()).toContain("Signups by week.");
    expect(text()).toContain("@fotoflo · made with Weft");
    expect(text()).not.toMatch(CAPTURE); // no capture, so no inset picture
    const options = seen.options as { width: number; height: number; fonts: { name: string }[]; emoji?: string };
    expect([options.width, options.height]).toEqual([APP_CARD_SIZE.width, APP_CARD_SIZE.height]);
    expect(options.fonts[0]?.name).toBe("Fraunces");
    expect(options.emoji).toBe("twemoji");
  });

  it("insets the capture when there is one", async () => {
    await appCardImage({ name: "Docs", byline: "Acme", shot: PNG });
    expect(text()).toContain(`"props":{"src":"${imageDataUrl(PNG)}"}`);
  });

  it("leaves the description out when there isn't one", async () => {
    await appCardImage({ name: "Docs", byline: "Acme" });
    expect(text()).not.toContain("Signups");
  });

  it("sets a long title smaller than a short one", async () => {
    await appCardImage({ name: "Short", byline: "a" });
    const short = /"fontSize":(\d+),"lineHeight":1.02/.exec(text())?.[1];
    await appCardImage({ name: "A much longer name than twenty-four characters", byline: "a" });
    const long = /"fontSize":(\d+),"lineHeight":1.02/.exec(text())?.[1];
    expect(Number(short)).toBeGreaterThan(Number(long));
  });

  it("offline, draws a letter instead of the emoji and asks for no twemoji", async () => {
    await appCardImage({ name: "📈 Growth", byline: "a" }, { emoji: false, headers: { "Cache-Control": "x" } });
    const options = seen.options as { headers?: Record<string, string>; emoji?: string };
    expect(options.emoji).toBeUndefined();
    expect(options.headers).toEqual({ "Cache-Control": "x" });
    expect(text()).toContain('"emoji":false');
  });
});
