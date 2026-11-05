// The R2 mirror's cron route: the bearer secret, the setup check, and what a run answers.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
const { mirrorPending, serviceClient, sweepAllResults } = vi.hoisted(() => ({ mirrorPending: vi.fn(), serviceClient: vi.fn(), sweepAllResults: vi.fn() }));
vi.mock("@/lib/r2-mirror", () => ({ mirrorPending }));
vi.mock("@/lib/host-result-sweep", () => ({ sweepAllResults }));
vi.mock("@/lib/web-session", () => ({ serviceClient }));

const { GET } = await import("./route");
const req = (auth?: string) => new Request("http://localhost/api/cron/r2-mirror", { headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("CRON_SECRET", "cron");
  vi.stubEnv("R2_ACCOUNT_ID", "acc");
  vi.stubEnv("R2_ACCESS_KEY_ID", "id");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
  serviceClient.mockReturnValue({ service: true });
  mirrorPending.mockResolvedValue({ copied: 3, bytes: 30, failed: [], more: false });
  sweepAllResults.mockResolvedValue({ orgs: 2, removed: 4, failed: [] });
});

describe("GET /api/cron/r2-mirror", () => {
  it("refuses a missing or wrong secret", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req("Bearer "))).status).toBe(401);
    expect(mirrorPending).not.toHaveBeenCalled();
  });

  it("says so when R2 or the service key isn't set up", async () => {
    serviceClient.mockReturnValue(null);
    expect((await GET(req("Bearer cron"))).status).toBe(503);
    serviceClient.mockReturnValue({ service: true });
    vi.stubEnv("WEFT_BLOBS_R2", "off");
    expect((await GET(req("Bearer cron"))).status).toBe(503);
  });

  it("runs the mirror and answers its counts", async () => {
    const res = await GET(req("Bearer cron"));
    expect(await res.json()).toEqual({ copied: 3, bytes: 30, failed: 0, more: false, results: 4 });
    expect(sweepAllResults).toHaveBeenCalledWith({ service: true });
    expect(mirrorPending).toHaveBeenCalledWith({ service: true }, expect.objectContaining({ accountId: "acc", bucket: "weft-blobs" }));
  });

  it("logs failures and counts them", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mirrorPending.mockResolvedValue({ copied: 1, bytes: 1, failed: ["download x: gone"], more: true });
    expect(((await (await GET(req("Bearer cron"))).json()) as { failed: number }).failed).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("gone"));
    error.mockRestore();
  });

  it("is a 502 when the run throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mirrorPending.mockRejectedValue(new Error("blob_mirror_pending: permission denied"));
    expect((await GET(req("Bearer cron"))).status).toBe(502);
    error.mockRestore();
  });

  it("sweeps host results even without R2, and a failed sweep never stops the mirror", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("WEFT_BLOBS_R2", "off");
    expect((await GET(req("Bearer cron"))).status).toBe(503);
    expect(sweepAllResults).toHaveBeenCalledTimes(1);
    vi.stubEnv("WEFT_BLOBS_R2", "");
    sweepAllResults.mockResolvedValue({ orgs: 1, removed: 0, failed: ["org-1: list failed"] });
    expect(((await (await GET(req("Bearer cron"))).json()) as { copied: number }).copied).toBe(3);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("list failed"));
    sweepAllResults.mockRejectedValue(new Error("no workers table"));
    expect(((await (await GET(req("Bearer cron"))).json()) as { results: number }).results).toBe(0);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("no workers table"));
    error.mockRestore();
  });
});
