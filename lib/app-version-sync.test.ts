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
const report = (version = `0.${n}.0`) => () => ({ version, channel: "release" as const, platform: "darwin" });

describe("ownReport", () => {
  it("reads the build's version and tells a packaged build from dev mode", () => {
    expect(ownReport({ NEXT_PUBLIC_APP_VERSION: "0.6.6", NODE_ENV: "production" }, "darwin")).toEqual({ version: "0.6.6", channel: "release", platform: "darwin" });
    expect(ownReport({ NEXT_PUBLIC_APP_VERSION: "0.6.6", NODE_ENV: "development" }, "darwin")).toEqual({ version: "0.6.6", channel: "dev", platform: "darwin" });
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
    const rpc = vi.fn<Rpc>().mockResolvedValue({ data: null, error: null });
    await expect(syncAppVersion({ client: () => clientWith(rpc), report: report("0.6.6"), now: () => DAY })).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("app_version_submit", { p_version: "0.6.6", p_channel: "release", p_platform: "darwin" });
  });

  it("posts once a day, and again the next day or on a new version", async () => {
    const rpc = vi.fn<Rpc>().mockResolvedValue({ data: null, error: null });
    const client = () => clientWith(rpc);
    const r = report();
    expect(await syncAppVersion({ client, report: r, now: () => DAY })).toBe(true);
    expect(await syncAppVersion({ client, report: r, now: () => DAY + 3_600_000 })).toBe(false);
    expect(await syncAppVersion({ client, report: r, now: () => DAY + 86_400_000 })).toBe(true);
    expect(await syncAppVersion({ client, report: report(`9.${n}.0`), now: () => DAY + 86_400_000 })).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(3);
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

  it("throws any other error", async () => {
    const rpc = vi.fn<Rpc>().mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(syncAppVersion({ client: () => clientWith(rpc), report: report() })).rejects.toThrow("boom");
  });

  it("uses the default report and client", async () => {
    expect(await syncAppVersion({ report: report() })).toBe(false);
  });
});
