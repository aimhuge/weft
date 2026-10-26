import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/account/keychain-events: the audit log from your Weft account, for Settings → Security.

// No launch token on a test run, even on a Mac where Weft is running and wrote one.
vi.mock("@/lib/shell-token", () => ({ shellToken: () => "" }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/keychain-audit-record", () => ({
  readKeychainRecord: vi.fn(() => Promise.resolve({ signedIn: true, owner: "Alex", entries: [] })),
}));

const record = await import("@/lib/keychain-audit-record");
const route = await import("./account/keychain-events/route");

beforeEach(() => vi.clearAllMocks());

describe("GET /account/keychain-events", () => {
  it("returns the record", async () => {
    const res = await route.GET(new Request("http://localhost/api/account/keychain-events", { headers: { host: "localhost:3457" } }));
    expect(await res.json()).toEqual({ signedIn: true, owner: "Alex", entries: [] });
  });

  it("refuses other hosts and reports failures", async () => {
    expect((await route.GET(new Request("http://evil/api/account/keychain-events", { headers: { host: "evil.com" } }))).status).toBe(403);
    vi.mocked(record.readKeychainRecord).mockRejectedValueOnce(new Error("offline"));
    const res = await route.GET(new Request("http://localhost/api/account/keychain-events", { headers: { host: "localhost" } }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "offline" });
  });
});
