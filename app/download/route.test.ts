import { afterEach, describe, expect, it, vi } from "vitest";

const latestRelease = vi.fn();
vi.mock("@/lib/home-release", () => ({ latestRelease }));

afterEach(() => latestRelease.mockReset());

describe("GET /download", () => {
  it("redirects to the newest release's dmg", async () => {
    latestRelease.mockResolvedValue({ version: "0.6.0", dmg: "https://x/Weft-0.6.0-arm64.dmg", page: "https://x/tag" });
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://x/Weft-0.6.0-arm64.dmg");
  });

  it("sends people to the releases page when there's no release", async () => {
    latestRelease.mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.headers.get("location")).toBe("https://github.com/aimhuge/weft/releases");
  });
});
