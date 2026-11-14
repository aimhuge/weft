import { afterEach, describe, expect, it, vi } from "vitest";

const testflightPublicUrl = vi.fn();
const captureDownload = vi.fn();
vi.mock("@/lib/testflight", () => ({ testflightPublicUrl }));
vi.mock("@/lib/download-track", () => ({ captureDownload }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn(), connection: () => Promise.resolve() }));

afterEach(() => {
  testflightPublicUrl.mockReset();
  captureDownload.mockReset();
});

describe("GET /download/ios", () => {
  it("redirects to the public TestFlight link and counts it", async () => {
    testflightPublicUrl.mockReturnValue("https://testflight.apple.com/join/AbC123");
    const { GET } = await import("./route");
    const res = await GET(new Request("https://weft.zip/download/ios?from=hero"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://testflight.apple.com/join/AbC123");
    expect(captureDownload).toHaveBeenCalledWith(expect.any(Request), { platform: "ios", arch: null, version: null });
  });

  it("goes home before the TestFlight link is set", async () => {
    testflightPublicUrl.mockReturnValue(null);
    const { GET } = await import("./route");
    const res = await GET(new Request("https://weft.zip/download/ios"));
    expect(res.headers.get("location")).toBe("https://weft.zip/");
  });
});
