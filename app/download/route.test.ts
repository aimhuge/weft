import { afterEach, describe, expect, it, vi } from "vitest";

const latestRelease = vi.fn();
const captureDownload = vi.fn();
vi.mock("@/lib/home-release", () => ({ latestRelease }));
vi.mock("@/lib/download-track", () => ({ captureDownload }));
// after() runs its callback once the response is sent; here, right away.
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));

afterEach(() => {
  latestRelease.mockReset();
  captureDownload.mockReset();
});

const request = (url = "https://weft.zip/download?from=hero") => new Request(url);

describe("GET /download", () => {
  it("redirects to the newest release's dmg and counts the download", async () => {
    latestRelease.mockResolvedValue({ version: "0.6.0", dmg: "https://x/Weft-0.6.0-arm64.dmg", page: "https://x/tag" });
    const { GET } = await import("./route");
    const req = request();
    const res = await GET(req);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://x/Weft-0.6.0-arm64.dmg");
    expect(captureDownload).toHaveBeenCalledWith(req, { platform: "mac", arch: "arm64", version: "0.6.0" });
  });

  it("sends people to the releases page when there's no release", async () => {
    latestRelease.mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET(request());
    expect(res.headers.get("location")).toBe("https://github.com/aimhuge/weft/releases");
    expect(captureDownload).toHaveBeenCalledWith(expect.any(Request), { platform: "mac", arch: "arm64", version: null });
  });
});
