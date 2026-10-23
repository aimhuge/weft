import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/blastcp: the drawer's "Connect with Weft". lib/blastcp-auto is mocked.

const auto = vi.hoisted(() => ({ connectBlastcpWithWeft: vi.fn() }));
vi.mock("@/lib/blastcp-auto", () => auto);

const route = await import("./blastcp/route");

const WRITE = { host: "localhost:3457", "x-weft-token": "1" };
const req = (headers: Record<string, string>) => new Request("http://localhost:3457/api/blastcp", { method: "POST", headers });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/blastcp", () => {
  it("connects with force and answers only the outcome", async () => {
    auto.connectBlastcpWithWeft.mockResolvedValue({ state: "connected", email: "me@x.com" });
    const res = await route.POST(req(WRITE));
    expect(await res.json()).toEqual({ state: "connected", email: "me@x.com" });
    expect(auto.connectBlastcpWithWeft).toHaveBeenCalledWith(true);
  });

  it("answers 400 with the reason when main can't connect", async () => {
    auto.connectBlastcpWithWeft.mockRejectedValue(new Error("Keychain"));
    const res = await route.POST(req(WRITE));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch("Keychain");
  });

  it("refuses a foreign Host", async () => {
    expect((await route.POST(req({ host: "evil.com" }))).status).toBe(403);
    expect(auto.connectBlastcpWithWeft).not.toHaveBeenCalled();
  });
});
