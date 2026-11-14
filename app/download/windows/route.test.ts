import { afterEach, describe, expect, it, vi } from "vitest";

const latestWindowsInstaller = vi.fn();
const captureDownload = vi.fn();
vi.mock("@/lib/home-release", () => ({ latestWindowsInstaller }));
vi.mock("@/lib/download-track", async (real) => ({ ...(await real<typeof import("@/lib/download-track")>()), captureDownload }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));

afterEach(() => {
  latestWindowsInstaller.mockReset();
  captureDownload.mockReset();
});

describe("GET /download/windows", () => {
  it("redirects to the newest Windows installer and counts it with its version", async () => {
    latestWindowsInstaller.mockResolvedValue("https://x/download/v0.7.6/Weft-Setup-0.7.6-x64.exe");
    const { GET } = await import("./route");
    const res = await GET(new Request("https://weft.zip/download/windows"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://x/download/v0.7.6/Weft-Setup-0.7.6-x64.exe");
    expect(latestWindowsInstaller).toHaveBeenCalledWith("x64");
    expect(captureDownload).toHaveBeenCalledWith(expect.any(Request), { platform: "windows", arch: "x64", version: "0.7.6" });
  });

  it("reads the arm64 installer with ?arch=arm64", async () => {
    latestWindowsInstaller.mockResolvedValue("https://x/download/v0.7.6/Weft-Setup-0.7.6-arm64.exe");
    const { GET } = await import("./route");
    const res = await GET(new Request("https://weft.zip/download/windows?arch=arm64&from=hero"));
    expect(res.headers.get("location")).toBe("https://x/download/v0.7.6/Weft-Setup-0.7.6-arm64.exe");
    expect(latestWindowsInstaller).toHaveBeenCalledWith("arm64");
    expect(captureDownload).toHaveBeenCalledWith(expect.any(Request), { platform: "windows", arch: "arm64", version: "0.7.6" });
  });

  it("sends people to the releases page before a release carries one", async () => {
    latestWindowsInstaller.mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET(new Request("https://weft.zip/download/windows"));
    expect(res.headers.get("location")).toBe("https://github.com/aimhuge/weft/releases");
    expect(captureDownload).toHaveBeenCalledWith(expect.any(Request), { platform: "windows", arch: "x64", version: null });
  });
});
