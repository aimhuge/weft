import { afterEach, describe, expect, it, vi } from "vitest";

const latestWindowsInstaller = vi.fn();
vi.mock("@/lib/home-release", () => ({ latestWindowsInstaller }));

afterEach(() => latestWindowsInstaller.mockReset());

describe("GET /download/windows", () => {
  it("redirects to the newest Windows installer", async () => {
    latestWindowsInstaller.mockResolvedValue("https://x/v0.7.6/Weft-Setup-0.7.6-x64.exe");
    const { GET } = await import("./route");
    const res = await GET(new Request("https://weft.zip/download/windows"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://x/v0.7.6/Weft-Setup-0.7.6-x64.exe");
    expect(latestWindowsInstaller).toHaveBeenCalledWith("x64");
  });

  it("reads the arm64 installer with ?arch=arm64", async () => {
    latestWindowsInstaller.mockResolvedValue("https://x/v0.7.6/Weft-Setup-0.7.6-arm64.exe");
    const { GET } = await import("./route");
    const res = await GET(new Request("https://weft.zip/download/windows?arch=arm64"));
    expect(res.headers.get("location")).toBe("https://x/v0.7.6/Weft-Setup-0.7.6-arm64.exe");
    expect(latestWindowsInstaller).toHaveBeenCalledWith("arm64");
  });

  it("sends people to the releases page before a release carries one", async () => {
    latestWindowsInstaller.mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET(new Request("https://weft.zip/download/windows"));
    expect(res.headers.get("location")).toBe("https://github.com/aimhuge/weft/releases");
  });
});
