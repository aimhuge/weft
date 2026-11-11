import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));

import { cacheLife } from "next/cache";
import { FEED, WINDOWS_ARM_FEED, WINDOWS_FEED } from "./home";
import { RELEASE_API, latestRelease, latestWindowsInstaller } from "./home-release";

const dmg = "https://github.com/aimhuge/weft/releases/download/v0.3.0/Weft-0.3.0-arm64.dmg";
const respond = (status: number, body: unknown) =>
  vi.fn(() => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })) as unknown as typeof fetch;

describe("latestRelease", () => {
  it("fetches the feed, caches for hours and returns the newest release", async () => {
    const fetchFn = respond(200, { releases: [{ version: "0.3.0", dmg, page: "https://x/tag" }] });
    await expect(latestRelease(fetchFn)).resolves.toEqual({ version: "0.3.0", dmg, page: "https://x/tag" });
    expect(fetchFn).toHaveBeenCalledWith(FEED, expect.objectContaining({ headers: { accept: "application/json" } }));
    // AbortSignal is an interface, not a class, so `expect.any(AbortSignal)` is `any` and trips the lint rule;
    // reach into the call's options to check the timeout signal is wired up.
    const [, options] = vi.mocked(fetchFn).mock.calls[0]!;
    const signal = (options as { signal?: unknown }).signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect((signal as AbortSignal).aborted).toBe(false);
    expect(cacheLife).toHaveBeenCalledWith("minutes");
  });

  it("is null before the first release (GitHub answers 404)", async () => {
    await expect(latestRelease(respond(404, "Not Found"))).resolves.toBeNull();
  });

  it("is null when the feed isn't a release list", async () => {
    await expect(latestRelease(respond(200, { nope: true }))).resolves.toBeNull();
  });

  it("uses the global fetch by default", async () => {
    const stub = respond(200, { releases: [{ version: "0.4.0", dmg }] });
    vi.stubGlobal("fetch", stub);
    try {
      await expect(latestRelease()).resolves.toEqual({ version: "0.4.0", dmg, page: dmg });
      expect(stub).toHaveBeenCalledWith(FEED, expect.anything());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("is null when GitHub can't be reached", async () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    await expect(latestRelease(fetchFn)).resolves.toBeNull();
  });
});

// The download path answers status (504 when GitHub's CDN is down), the API answers api.
const feedDown = (api: { status: number; body?: unknown } | Error, status = 504) =>
  vi.fn((url: string) => {
    if (url !== RELEASE_API) return Promise.resolve({ ok: false, status, json: () => Promise.reject(new Error("504")) });
    if (api instanceof Error) return Promise.reject(api);
    return Promise.resolve({ ok: api.status < 400, status: api.status, json: () => Promise.resolve(api.body) });
  }) as unknown as typeof fetch;
const tag = "https://github.com/aimhuge/weft/releases/tag/v0.8.0";
const asset = (name: string) => ({ name, browser_download_url: `https://github.com/aimhuge/weft/releases/download/v0.8.0/${name}` });
const apiBody = {
  tag_name: "v0.8.0",
  html_url: tag,
  assets: [asset("update.json"), asset("Weft-0.8.0-arm64.dmg"), asset("Weft-Setup-0.8.0-x64.exe"), asset("Weft-Setup-0.8.0-arm64.exe")],
};

describe("latestRelease's API fallback", () => {
  it("reads the tag and dmg from GitHub's API when the download path answers 504", async () => {
    const fetchFn = feedDown({ status: 200, body: apiBody });
    await expect(latestRelease(fetchFn)).resolves.toEqual({ version: "0.8.0", dmg: asset("Weft-0.8.0-arm64.dmg").browser_download_url, page: tag });
    expect(fetchFn).toHaveBeenCalledWith(RELEASE_API, expect.objectContaining({ headers: { accept: "application/vnd.github+json" } }));
  });

  it("falls back when the feed fetch throws (a timeout), and links the dmg when the API sends no page", async () => {
    const fetchFn = vi.fn((url: string) =>
      url === RELEASE_API
        ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ...apiBody, html_url: undefined, tag_name: "0.8.1" }) })
        : Promise.reject(new Error("timeout")),
    ) as unknown as typeof fetch;
    const dmgUrl = asset("Weft-0.8.0-arm64.dmg").browser_download_url;
    await expect(latestRelease(fetchFn)).resolves.toEqual({ version: "0.8.1", dmg: dmgUrl, page: dmgUrl });
  });

  it("is null when the API is down too, sends no release, or the release has no dmg", async () => {
    await expect(latestRelease(feedDown({ status: 503 }))).resolves.toBeNull();
    await expect(latestRelease(feedDown(new Error("offline")))).resolves.toBeNull();
    await expect(latestRelease(feedDown({ status: 200, body: null }))).resolves.toBeNull();
    await expect(latestRelease(feedDown({ status: 200, body: { tag_name: "v0.8.0" } }))).resolves.toBeNull();
    const noDmg = { ...apiBody, assets: [null, { name: 3 }, asset("update.json")] };
    await expect(latestRelease(feedDown({ status: 200, body: noDmg }))).resolves.toBeNull();
  });
});

describe("latestWindowsInstaller", () => {
  const yml = "version: 0.7.6\npath: Weft-Setup-0.7.6-x64.exe\nsha512: abc\n";
  const text = (status: number, body: string) =>
    vi.fn(() => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(body) })) as unknown as typeof fetch;

  it("points at the installer latest.yml names, on its own release", async () => {
    const fetchFn = text(200, yml);
    await expect(latestWindowsInstaller("x64", fetchFn)).resolves.toBe("https://github.com/aimhuge/weft/releases/download/v0.7.6/Weft-Setup-0.7.6-x64.exe");
    expect(fetchFn).toHaveBeenCalledWith(WINDOWS_FEED, expect.anything());
  });

  it("reads arm64's own feed for an ARM PC", async () => {
    const fetchFn = text(200, "version: 0.7.6\npath: Weft-Setup-0.7.6-arm64.exe\n");
    await expect(latestWindowsInstaller("arm64", fetchFn)).resolves.toBe("https://github.com/aimhuge/weft/releases/download/v0.7.6/Weft-Setup-0.7.6-arm64.exe");
    expect(fetchFn).toHaveBeenCalledWith(WINDOWS_ARM_FEED, expect.anything());
  });

  it("is null before a release carries a Windows build, or when GitHub can't be reached", async () => {
    await expect(latestWindowsInstaller("x64", text(404, "Not Found"))).resolves.toBeNull();
    await expect(latestWindowsInstaller("x64", vi.fn(() => Promise.reject(new Error("offline"))) as unknown as typeof fetch)).resolves.toBeNull();
  });

  it("finds the arch's installer through GitHub's API when the download path is down", async () => {
    await expect(latestWindowsInstaller("x64", feedDown({ status: 200, body: apiBody }))).resolves.toBe(asset("Weft-Setup-0.8.0-x64.exe").browser_download_url);
    await expect(latestWindowsInstaller("arm64", feedDown({ status: 200, body: apiBody }))).resolves.toBe(asset("Weft-Setup-0.8.0-arm64.exe").browser_download_url);
    await expect(latestWindowsInstaller("x64", feedDown({ status: 200, body: { ...apiBody, assets: [] } }))).resolves.toBeNull();
    await expect(latestWindowsInstaller("x64", feedDown(new Error("offline")))).resolves.toBeNull();
  });

  it("uses the global fetch by default", async () => {
    vi.stubGlobal("fetch", text(200, "files: []\n"));
    try {
      await expect(latestWindowsInstaller()).resolves.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
