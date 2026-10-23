// app/opengraph-image.tsx: every weft.zip page's link preview. It 500'd in production from 2026-10-16 to 10-23
// because Satori couldn't read the variable Fraunces font, and no test drew it. This one does.
import { describe, expect, it } from "vitest";
import Image, { contentType, size } from "./opengraph-image";

describe("opengraph-image", () => {
  it("draws a 1200x630 PNG from the files it ships with", async () => {
    const res = await Image();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(contentType);
    const png = Buffer.from(await res.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(size.width);
    expect(png.readUInt32BE(20)).toBe(size.height);
  }, 30_000);
});
