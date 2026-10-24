import { afterEach, describe, expect, it, vi } from "vitest";

// /api/admin/gate, /api/admin/users, /api/admin/local. The admin gate is the same
// requireSuperAdminWeft() in all three, mocked here; the route-specific logic
// (json shape, env-driven service key, fs reads) is what each describe covers.

vi.mock("next/server", () => ({ connection: async () => {} }));

const adminMock = vi.hoisted(() => ({
  requireSuperAdminWeft: vi.fn(),
  isAdminWeft: vi.fn(),
  adminServiceClient: vi.fn(),
}));
vi.mock("@/lib/admin", () => adminMock);

const gate = await import("./admin/gate/route");
const users = await import("./admin/users/route");
const localRoute = await import("./admin/local/route");

const READ = { host: "127.0.0.1:3457" } as const;

function get(route: { GET: (req: Request) => Promise<Response> }, path: string, headers: Record<string, string> = READ) {
  return route.GET(new Request(`http://127.0.0.1:3457${path}`, { headers }));
}

const body = (res: Response) => res.json() as Promise<Record<string, unknown>>;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("/api/admin/gate", () => {
  it("returns { admin: true } when the signed-in Weft account is on SUPER_ADMIN_EMAILS", async () => {
    adminMock.isAdminWeft.mockResolvedValueOnce(true);
    const res = await get(gate, "/api/admin/gate");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ admin: true });
  });

  it("returns { admin: false } for everyone else", async () => {
    adminMock.isAdminWeft.mockResolvedValueOnce(false);
    const res = await get(gate, "/api/admin/gate");
    expect(await res.json()).toEqual({ admin: false });
  });

  it("refuses non-localhost hosts", async () => {
    const res = await get(gate, "/api/admin/gate", { host: "evil.com" });
    expect(res.status).toBe(403);
    expect(adminMock.isAdminWeft).not.toHaveBeenCalled();
  });

  it("returns 500 when the gate throws", async () => {
    adminMock.isAdminWeft.mockRejectedValueOnce(new Error("disk"));
    const res = await get(gate, "/api/admin/gate");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "disk" });
  });
});

describe("/api/admin/users", () => {
  it("refuses unauthenticated callers (gate runs first)", async () => {
    adminMock.requireSuperAdminWeft.mockRejectedValueOnce(new Error("NEXT_NOT_FOUND"));
    const res = await get(users, "/api/admin/users");
    // fail() defaults to 400; the route uses the default rather than 500.
    expect(res.status).toBe(400);
    expect(adminMock.adminServiceClient).not.toHaveBeenCalled();
  });

  it("returns 503 with rows: [] when SUPABASE_SECRET_KEY is missing", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce({ email: "ada@b.co", user: { id: "u1", email: "ada@b.co", name: "Ada", avatar: null, provider: "github" } });
    adminMock.adminServiceClient.mockResolvedValueOnce(null);
    const res = await get(users, "/api/admin/users");
    expect(res.status).toBe(503);
    const data = await body(res);
    expect(typeof data.error).toBe("string");
    expect(data.error as string).toMatch(/SUPABASE_SECRET_KEY/);
    expect(data.rows).toEqual([]);
    expect(data.total).toBe(0);
  });

  it("returns paginated rows + total from the auth admin API, joined to profiles", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const { service, listUsers } = serviceWith(FIXTURE_USERS);
    adminMock.adminServiceClient.mockResolvedValueOnce(service);

    const res = await get(users, "/api/admin/users?skip=0&take=20&sort=created_at+desc");
    expect(res.status).toBe(200);
    expect(listUsers).toHaveBeenCalledWith({ page: 1, perPage: 1000 });
    const data = await body(res);
    const rows = data.rows as Array<Record<string, unknown>>;
    expect(data.total).toBe(2);
    // Newest first: u2 joined after u1.
    expect(rows.map((r) => r.id)).toEqual(["u2", "u1"]);
    expect(rows[1]).toMatchObject({ id: "u1", email: "ada@b.co", name: "Ada", provider: "github" });
    // u2 has no profile and empty metadata, so its name falls through to null.
    expect(rows[0]).toMatchObject({ id: "u2", email: "lin@b.co", name: null, provider: "google", lastSignInAt: null });
  });

  it("names a user from metadata when there's no profile", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const { service } = serviceWith([{ id: "u3", email: "kim@b.co", user_metadata: { user_name: "kim" } }], []);
    adminMock.adminServiceClient.mockResolvedValueOnce(service);
    const rows = (await body(await get(users, "/api/admin/users"))).rows as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ name: "kim", provider: null, createdAt: null, avatarUrl: null });
  });

  it("filters by q (email contains), sorts and pages the matches", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const many = [
      { id: "a", email: "Zed@acme.co", created_at: "2025-01-01T00:00:00Z" },
      { id: "b", email: "amy@acme.co", created_at: "2025-02-01T00:00:00Z" },
      { id: "c", email: "bob@other.co", created_at: "2025-03-01T00:00:00Z" },
      { id: "d", email: null },
    ];
    const { service } = serviceWith(many, []);
    adminMock.adminServiceClient.mockResolvedValueOnce(service);
    const data = await body(await get(users, "/api/admin/users?q=ACME&sort=email+asc&skip=1&take=1"));
    expect(data.total).toBe(2);
    expect((data.rows as Array<{ id: string }>).map((r) => r.id)).toEqual(["a"]);
  });

  it("sorts users with no value last", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const { service } = serviceWith(
      [
        { id: "x", email: "x@b.co", last_sign_in_at: null },
        { id: "y", email: "y@b.co", last_sign_in_at: "2026-01-01T00:00:00Z" },
        { id: "z", email: "z@b.co", last_sign_in_at: "2026-01-01T00:00:00Z" },
      ],
      [],
    );
    adminMock.adminServiceClient.mockResolvedValueOnce(service);
    const data = await body(await get(users, "/api/admin/users?sort=last_sign_in_at+asc"));
    expect((data.rows as Array<{ id: string }>).map((r) => r.id)).toEqual(["y", "z", "x"]);
  });

  it("reads every page of users until a short one", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const full = Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}`, email: `p${i}@b.co` }));
    const listUsers = vi
      .fn<(p: { page: number; perPage: number }) => Promise<{ data: { users: unknown[] } | null; error: unknown }>>()
      .mockResolvedValueOnce({ data: { users: full }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    adminMock.adminServiceClient.mockResolvedValueOnce({ auth: { admin: { listUsers } }, from: profilesFrom([]) });
    const data = await body(await get(users, "/api/admin/users"));
    expect(listUsers).toHaveBeenCalledTimes(2);
    expect(listUsers).toHaveBeenLastCalledWith({ page: 2, perPage: 1000 });
    expect(data.total).toBe(1000);
  });

  it("answers the auth API's error message, not [object Object]", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce(ADMIN);
    const listUsers = vi.fn(() => Promise.resolve({ data: null, error: { message: "User not allowed", status: 403 } }));
    adminMock.adminServiceClient.mockResolvedValueOnce({ auth: { admin: { listUsers } }, from: profilesFrom([]) });
    const res = await get(users, "/api/admin/users");
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("User not allowed");
  });

  it("rejects non-localhost hosts", async () => {
    const res = await get(users, "/api/admin/users", { host: "evil.com" });
    expect(res.status).toBe(403);
    expect(adminMock.requireSuperAdminWeft).not.toHaveBeenCalled();
  });
});

describe("/api/admin/local", () => {
  it("returns the local overview when the gate clears", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce({ email: "ada@b.co", user: { id: "u1", email: "ada@b.co", name: "Ada", avatar: null, provider: "github" } });
    const res = await get(localRoute, "/api/admin/local");
    // The route reads the real DATA_DIR; the shape is what we care about.
    expect(res.status).toBe(200);
    const data = await body(res);
    expect(typeof data.dataDir).toBe("string");
    expect(typeof data.version).toBe("string");
    expect(typeof data.uptime).toBe("number");
    const board = data.board as Record<string, unknown>;
    expect(typeof board.cards).toBe("number");
    expect(typeof board.archived).toBe("number");
    expect(typeof board.threads).toBe("number");
    const activity = data.activity as Record<string, unknown>;
    expect(typeof activity.entries).toBe("number");
    const pages = data.pages as Record<string, unknown>;
    expect(typeof pages.count).toBe("number");
    expect(typeof pages.bytes).toBe("number");
    expect(typeof data.settings).toBe("object");
  });

  it("refuses unauthenticated callers", async () => {
    adminMock.requireSuperAdminWeft.mockRejectedValueOnce(new Error("NEXT_NOT_FOUND"));
    const res = await get(localRoute, "/api/admin/local");
    expect(res.status).toBe(400);
  });

  it("rejects non-localhost hosts", async () => {
    const res = await get(localRoute, "/api/admin/local", { host: "evil.com" });
    expect(res.status).toBe(403);
  });
});

const ADMIN = { email: "ada@b.co", user: { id: "u1", email: "ada@b.co", name: "Ada", avatar: null, provider: "github" } };

const FIXTURE_USERS: AuthUser[] = [
  {
    id: "u1",
    email: "ada@b.co",
    user_metadata: { full_name: "Ada", avatar_url: "https://img/ada.png" },
    created_at: "2025-01-01T00:00:00Z",
    last_sign_in_at: "2026-10-01T00:00:00Z",
    app_metadata: { provider: "github" },
  },
  {
    id: "u2",
    email: "lin@b.co",
    user_metadata: {},
    created_at: "2025-06-01T00:00:00Z",
    last_sign_in_at: null,
    app_metadata: { provider: "google" },
  },
];

const FIXTURE_PROFILES: ProfileFixture[] = [
  { id: "u1", name: "Ada", avatar_url: "https://img/ada.png" },
];

// A user as auth.admin.listUsers returns it.
interface AuthUser {
  id: string;
  email: string | null;
  user_metadata?: Record<string, unknown>;
  created_at?: string;
  last_sign_in_at?: string | null;
  app_metadata?: { provider?: string };
}

interface ProfileFixture {
  id: string;
  name: string;
  avatar_url: string;
}

function profilesFrom(profiles: ProfileFixture[]) {
  return (table: string) => {
    if (table !== "profiles") throw new Error(`unexpected table ${table}`);
    return { select: vi.fn(() => ({ in: vi.fn(() => Promise.resolve({ data: profiles, error: null })) })) };
  };
}

// A service client whose auth admin API answers one short page of users.
function serviceWith(list: AuthUser[], profiles: ProfileFixture[] = FIXTURE_PROFILES) {
  const listUsers = vi.fn(() => Promise.resolve({ data: { users: list }, error: null }));
  return { listUsers, service: { auth: { admin: { listUsers } }, from: profilesFrom(profiles) } };
}
