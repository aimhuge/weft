import { afterEach, describe, expect, it, vi } from "vitest";

// The Users admin page's edge cases: a sort column nobody may inject, a page number that isn't a
// number, an account with a profile but no name in it, a profiles lookup that came back empty or
// broken, and an auth API that failed without saying why.

vi.mock("next/server", () => ({ connection: async () => {} }));

const adminMock = vi.hoisted(() => ({
  requireSuperAdminWeft: vi.fn(),
  isAdminWeft: vi.fn(),
  adminServiceClient: vi.fn(),
}));
vi.mock("@/lib/admin", () => adminMock);

const users = await import("./admin/users/route");

const READ = { host: "127.0.0.1:3457" } as const;

function get(path: string) {
  return users.GET(new Request(`http://127.0.0.1:3457${path}`, { headers: READ }));
}

const body = (res: Response) => res.json() as Promise<Record<string, unknown>>;

const ADMIN = { email: "ada@b.co", user: { id: "u1", email: "ada@b.co", name: "Ada", avatar: null, provider: "github" } };

// A service client whose auth admin API answers one page of users, whose profiles lookup answers
// the given rows (or null), and whose admin_users_last_seen answers the given rows.
function service(list: unknown[], profiles: unknown[] | null = [], lastSeen: unknown[] = []) {
  const listUsers = vi.fn(() => Promise.resolve({ data: { users: list }, error: null }));
  return {
    listUsers,
    service: {
      auth: { admin: { listUsers } },
      from: (table: string) => {
        if (table !== "profiles") throw new Error(`unexpected table ${table}`);
        return { select: vi.fn(() => ({ in: vi.fn(() => Promise.resolve({ data: profiles, error: null })) })) };
      },
      rpc: vi.fn((fn: string) => Promise.resolve(fn === "admin_users_last_seen" ? { data: lastSeen, error: null } : { data: null, error: { message: fn } })),
    },
  };
}

afterEach(() => vi.clearAllMocks());

describe("/api/admin/users: the page and the sort", () => {
  it("falls back to the first page when the skip isn't a number", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const { service: s } = service([{ id: "a", email: "a@b.co" }]);
    adminMock.adminServiceClient.mockResolvedValueOnce(s);
    const data = await body(await get("/api/admin/users?skip=abc"));
    expect((data.rows as Array<{ id: string }>).map((r) => r.id)).toEqual(["a"]);
  });

  it("falls back to the default page size when the take isn't a number", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const { service: s } = service([{ id: "a", email: "a@b.co" }]);
    adminMock.adminServiceClient.mockResolvedValueOnce(s);
    const data = await body(await get("/api/admin/users?take=abc"));
    expect((data.rows as unknown[]).length).toBe(1);
  });

  it("takes at least one account, and never more than the cap", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const many = Array.from({ length: 250 }, (_, i) => ({ id: `u${i}`, email: `u${i}@b.co` }));
    const { service: s } = service(many);
    adminMock.adminServiceClient.mockResolvedValueOnce(s);
    expect((await body(await get("/api/admin/users?take=0"))).rows as unknown[]).toHaveLength(1);
    adminMock.adminServiceClient.mockResolvedValueOnce(s);
    expect((await body(await get("/api/admin/users?take=9999"))).rows as unknown[]).toHaveLength(200);
  });

  it("ignores a sort column nobody may inject, and sorts by creation date", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const { service: s } = service([
      { id: "old", email: "o@b.co", created_at: "2025-01-01T00:00:00Z" },
      { id: "new", email: "n@b.co", created_at: "2026-01-01T00:00:00Z" },
    ]);
    adminMock.adminServiceClient.mockResolvedValueOnce(s);
    const data = await body(await get("/api/admin/users?sort=id;drop+table"));
    expect((data.rows as Array<{ id: string }>).map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("falls back to the creation date when the sort column is blank", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const { service: s } = service([
      { id: "old", email: "o@b.co", created_at: "2025-01-01T00:00:00Z" },
      { id: "new", email: "n@b.co", created_at: "2026-01-01T00:00:00Z" },
    ]);
    adminMock.adminServiceClient.mockResolvedValueOnce(s);
    const data = await body(await get("/api/admin/users?sort="));
    expect((data.rows as Array<{ id: string }>).map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("sorts by email, in the direction asked for", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const { service: s } = service([
      { id: "b", email: "B@b.co" },
      { id: "a", email: "a@b.co" },
    ]);
    adminMock.adminServiceClient.mockResolvedValueOnce(s);
    const asc = await body(await get("/api/admin/users?sort=email+asc"));
    expect((asc.rows as Array<{ id: string }>).map((r) => r.id)).toEqual(["a", "b"]);
    adminMock.adminServiceClient.mockResolvedValueOnce(s);
    const desc = await body(await get("/api/admin/users?sort=email+desc"));
    expect((desc.rows as Array<{ id: string }>).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("sorts descending when the direction is neither asc nor desc", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const { service: s } = service([
      { id: "b", email: "b@b.co" },
      { id: "a", email: "a@b.co" },
    ]);
    adminMock.adminServiceClient.mockResolvedValueOnce(s);
    const data = await body(await get("/api/admin/users?sort=email+sideways"));
    expect((data.rows as Array<{ id: string }>).map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("/api/admin/users: the profile join", () => {
  it("falls back to the metadata when the profile has no name", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const { service: s } = service([{ id: "u1", email: "a@b.co", user_metadata: { full_name: "Ada" } }], [{ id: "u1", name: null, avatar_url: null }]);
    adminMock.adminServiceClient.mockResolvedValueOnce(s);
    const rows = (await body(await get("/api/admin/users"))).rows as Array<{ name: string | null }>;
    expect(rows[0]?.name).toBe("Ada");
  });

  it("falls back to the metadata when the profile has no picture", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const { service: s } = service([{ id: "u1", email: "a@b.co", user_metadata: { picture: "https://img/a.png" } }], [{ id: "u1", name: "Ada", avatar_url: null }]);
    adminMock.adminServiceClient.mockResolvedValueOnce(s);
    const rows = (await body(await get("/api/admin/users"))).rows as Array<{ avatarUrl: string | null }>;
    expect(rows[0]?.avatarUrl).toBe("https://img/a.png");
  });

  it("asks for no profiles when the page is empty", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const from = vi.fn(() => {
      throw new Error("the profiles table was asked for");
    });
    const listUsers = vi.fn(() => Promise.resolve({ data: { users: [] }, error: null }));
    adminMock.adminServiceClient.mockResolvedValueOnce({
      auth: { admin: { listUsers } },
      from,
      rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
    });
    const data = await body(await get("/api/admin/users"));
    expect(data.rows).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("copes with a profiles lookup that came back with nothing", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const { service: s } = service([{ id: "u1", email: "a@b.co", user_metadata: { name: "Ada" } }], null);
    adminMock.adminServiceClient.mockResolvedValueOnce(s);
    const rows = (await body(await get("/api/admin/users"))).rows as Array<{ name: string | null }>;
    expect(rows[0]?.name).toBe("Ada");
  });
});

describe("/api/admin/users: the last-seen ledger", () => {  it("reads a ledger row that isn't a user or a time as no row", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const { service: s } = service([{ id: "u1", email: "a@b.co", last_sign_in_at: "2026-10-01T00:00:00Z" }], [], [
      { user_id: 7, last_seen_at: "junk" },
      { user_id: "u1", last_seen_at: 5 },
    ]);
    adminMock.adminServiceClient.mockResolvedValueOnce(s);
    const rows = (await body(await get("/api/admin/users"))).rows as Array<{ lastSeenAt: string | null }>;
    // Neither row was usable, so the sign-in stands in.
    expect(rows[0]?.lastSeenAt).toBe("2026-10-01T00:00:00Z");
  });

  it("falls back to the sign-in when the ledger answers something that isn't a list", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const listUsers = vi.fn(() => Promise.resolve({ data: { users: [{ id: "a", email: "a@b.co", last_sign_in_at: "2026-10-01T00:00:00Z" }] }, error: null }));
    adminMock.adminServiceClient.mockResolvedValueOnce({
      auth: { admin: { listUsers } },
      from: vi.fn(() => ({ select: vi.fn(() => ({ in: vi.fn(() => Promise.resolve({ data: [], error: null })) })) })),
      rpc: vi.fn(() => Promise.resolve({ data: { rows: [] }, error: null })),
    });
    const rows = (await body(await get("/api/admin/users"))).rows as Array<{ lastSeenAt: string | null }>;
    expect(rows[0]?.lastSeenAt).toBe("2026-10-01T00:00:00Z");
  });
});

describe("/api/admin/users: the auth API", () => {
  it("answers a failure that came without a message", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const listUsers = vi.fn(() => Promise.resolve({ data: null, error: {} }));
    adminMock.adminServiceClient.mockResolvedValueOnce({
      auth: { admin: { listUsers } },
      from: vi.fn(),
      rpc: vi.fn(),
    });
    const res = await get("/api/admin/users");
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("Couldn't list the users.");
  });

  it("copes with a page that came back with no users in it", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const listUsers = vi.fn(() => Promise.resolve({ data: null, error: null }));
    adminMock.adminServiceClient.mockResolvedValueOnce({
      auth: { admin: { listUsers } },
      from: vi.fn(),
      rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
    });
    const data = await body(await get("/api/admin/users"));
    expect(data.rows).toEqual([]);
    expect(data.total).toBe(0);
  });

  it("reads an account with no email as none", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const { service: s } = service([{ id: "u1" }]);
    adminMock.adminServiceClient.mockResolvedValueOnce(s);
    const rows = (await body(await get("/api/admin/users"))).rows as Array<{ email: string | null }>;
    expect(rows[0]?.email).toBeNull();
  });

  it("stops after ten pages, so a runaway answer can't loop forever", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const full = Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}`, email: `p${i}@b.co` }));
    const listUsers = vi.fn(() => Promise.resolve({ data: { users: full }, error: null }));
    adminMock.adminServiceClient.mockResolvedValueOnce({
      auth: { admin: { listUsers } },
      from: vi.fn(() => ({ select: vi.fn(() => ({ in: vi.fn(() => Promise.resolve({ data: [], error: null })) })) })),
      rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
    });
    await get("/api/admin/users");
    expect(listUsers).toHaveBeenCalledTimes(10);
  });
});
