import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));

import { cacheLife } from "next/cache";
import { FEED } from "./home";
import { latestRelease } from "./home-release";

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
