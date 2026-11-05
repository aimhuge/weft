// lib/app-version-sync.ts: reports this Mac's Weft version to app_versions once a UTC day while signed in.
// The same day and version isn't posted twice; a missing function is silent; any other error throws (the timer catches).
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signed = vi.hoisted(() => ({ signedIn: vi.fn() }));
vi.mock("./signed-in-client", () => ({ safeClient: () => null, signedIn: signed.signedIn }));

const { ownReport, syncAppVersion } = await import("./app-version-sync");

type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
const clientWith = (rpc: Rpc) => ({ rpc }) as unknown as SupabaseClient;
const DAY = Date.UTC(2026, 9, 29, 8);
let n = 0;

beforeEach(() => {
  vi.clearAllMocks();
  signed.signedIn.mockResolvedValue(true);
  n += 1;
});

// A version no earlier test posted, so the once-a-day memory doesn't leak between tests.
const report = (version = `0.${n}.0`) => () => ({ version, channel: "release" as const, platform: "darwin", commit: "abc1234" });
// Both calls answer: the version log, and this Mac's own row found.
const good = () => vi.fn<Rpc>((name) => Promise.resolve({ data: name === "desktop_set_build" ? true : null, error: null }));

describe("ownReport", () => {
  it("reads the build's version and tells a packaged build from dev mode", () => {
    expect(ownReport({ NEXT_PUBLIC_APP_VERSION: "0.6.6", NODE_ENV: "production" }, "darwin")).toEqual({ version: "0.6.6", channel: "release", platform: "darwin", commit: null });
    expect(ownReport({ NEXT_PUBLIC_APP_VERSION: "0.6.6", NODE_ENV: "development" }, "darwin")).toEqual({ version: "0.6.6", channel: "dev", platform: "darwin", commit: null });
  });

  it("reads the commit the build was made from, when it looks like one", () => {
    expect(ownReport({ NEXT_PUBLIC_APP_VERSION: "0.6.6", NEXT_PUBLIC_APP_COMMIT: "15388b1" }, "darwin")?.commit).toBe("15388b1");
    expect(ownReport({ NEXT_PUBLIC_APP_VERSION: "0.6.6", NEXT_PUBLIC_APP_COMMIT: "" }, "darwin")?.commit).toBeNull();
  });

  it("drops a server patch's build tag", () => {
    expect(ownReport({ NEXT_PUBLIC_APP_VERSION: "0.6.7+abc1234", NODE_ENV: "production" }, "darwin")?.version).toBe("0.6.7");
  });

  it("has nothing to report without a version", () => {
    expect(ownReport({}, "darwin")).toBeNull();
  });
});

describe("syncAppVersion", () => {
  it("posts the version as the signed-in caller", async () => {
    const rpc = good();
    await expect(syncAppVersion({ client: () => clientWith(rpc), report: report("0.6.6"), now: () => DAY, device: () => "dev1" })).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("app_version_submit", { p_version: "0.6.6", p_channel: "release", p_platform: "darwin", p_commit: "abc1234" });
    expect(rpc).toHaveBeenCalledWith("desktop_set_build", { p_device: "dev1", p_build: "0.6.6+abc1234", p_channel: "release" });
  });

  it("posts once a day, and again the next day or on a new version", async () => {
    const rpc = good();
    const client = () => clientWith(rpc);
    const r = report();
    expect(await syncAppVersion({ client, report: r, now: () => DAY })).toBe(true);
    expect(await syncAppVersion({ client, report: r, now: () => DAY + 3_600_000 })).toBe(false);
    expect(await syncAppVersion({ client, report: r, now: () => DAY + 86_400_000 })).toBe(true);
    expect(await syncAppVersion({ client, report: report(`9.${n}.0`), now: () => DAY + 86_400_000 })).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(6);
  });

  it("does nothing with no report, no client or nobody signed in", async () => {
    const rpc = vi.fn<Rpc>();
    expect(await syncAppVersion({ client: () => clientWith(rpc), report: () => null })).toBe(false);
    expect(await syncAppVersion({ client: () => null, report: report() })).toBe(false);
    signed.signedIn.mockResolvedValue(false);
    expect(await syncAppVersion({ client: () => clientWith(rpc), report: report() })).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("waits quietly when the function isn't deployed, and tries again next tick", async () => {
    const rpc = vi.fn<Rpc>().mockResolvedValue({ data: null, error: { message: "not found", code: "PGRST202" } });
    const r = report();
    expect(await syncAppVersion({ client: () => clientWith(rpc), report: r, now: () => DAY })).toBe(false);
    expect(await syncAppVersion({ client: () => clientWith(rpc), report: r, now: () => DAY })).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("reports a build without a commit as the bare version", async () => {
    const rpc = good();
    await syncAppVersion({ client: () => clientWith(rpc), report: () => ({ version: "9.1.0", channel: "dev", platform: "darwin", commit: null }), now: () => DAY, device: () => "d" });
    expect(rpc).toHaveBeenCalledWith("desktop_set_build", { p_device: "d", p_build: "9.1.0", p_channel: "dev" });
  });

  it("tries again next tick when this Mac has no row yet or the function isn't deployed", async () => {
    const r = report();
    const none = vi.fn<Rpc>((name) => Promise.resolve({ data: name === "desktop_set_build" ? false : null, error: null }));
    expect(await syncAppVersion({ client: () => clientWith(none), report: r, now: () => DAY })).toBe(false);
    const missing = vi.fn<Rpc>((name) => Promise.resolve({ data: null, error: name === "desktop_set_build" ? { message: "nf", code: "PGRST202" } : null }));
    expect(await syncAppVersion({ client: () => clientWith(missing), report: r, now: () => DAY })).toBe(false);
    expect(await syncAppVersion({ client: () => clientWith(good()), report: r, now: () => DAY })).toBe(true);
  });

  it("throws when the Mac's build can't be written", async () => {
    const rpc = vi.fn<Rpc>((name) => Promise.resolve({ data: null, error: name === "desktop_set_build" ? { message: "denied" } : null }));
    await expect(syncAppVersion({ client: () => clientWith(rpc), report: report() })).rejects.toThrow("denied");
  });

  it("throws any other error", async () => {
    const rpc = vi.fn<Rpc>().mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(syncAppVersion({ client: () => clientWith(rpc), report: report() })).rejects.toThrow("boom");
  });

  it("uses the default report and client", async () => {
    expect(await syncAppVersion({ report: report() })).toBe(false);
  });
});
