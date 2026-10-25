// /lib/admin.ts — the Weft super-admin gate. requireSuperAdminWeft reads the
// Weft account, checks the env allowlist (@aimhuge/admin) then the super_admins table, and
// either returns { email, user } or short-circuits with notFound() (which
// `next/navigation` throws — we mock it to throw NEXT_NOT_FOUND).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adminPkg = vi.hoisted(() => ({
  isAdminCaller: vi.fn(),
}));

const accountMock = vi.hoisted(() => ({
  accountView: vi.fn(),
  accountClient: vi.fn(),
  toAccountUser: vi.fn(),
}));

const navMock = vi.hoisted(() => ({ notFound: vi.fn() }));

// accountClient().from("super_admins").select().eq().maybeSingle()
const tableMock = vi.hoisted(() => ({ maybeSingle: vi.fn() }));

vi.mock("@aimhuge/admin", () => adminPkg);
vi.mock("./account", () => accountMock);
vi.mock("next/navigation", () => navMock);
vi.mock("next/server", () => ({ connection: async () => {} }));

const admin = await import("./admin");

const ADA = { id: "u1", email: "ada@b.co", name: "Ada", avatar: null, provider: "github" };

beforeEach(() => {
  vi.clearAllMocks();
  tableMock.maybeSingle.mockResolvedValue({ data: null });
  accountMock.accountClient.mockReturnValue({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: tableMock.maybeSingle }) }) }),
  });
  navMock.notFound.mockImplementation(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
  adminPkg.isAdminCaller.mockImplementation((caller: { email: string | null }) => Boolean(caller.email) && caller.email === "ada@b.co");
  accountMock.toAccountUser.mockImplementation((u: typeof ADA) => u);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requireSuperAdminWeft", () => {
  it("returns the email and the Weft account when the caller is on the env allowlist", async () => {
    accountMock.accountView.mockResolvedValueOnce({ configured: true, user: ADA });
    expect(await admin.requireSuperAdminWeft()).toEqual({ email: "ada@b.co", user: ADA });
    expect(tableMock.maybeSingle).not.toHaveBeenCalled();
  });

  it("lets in an account that has a super_admins row, even off the env allowlist", async () => {
    const bob = { ...ADA, id: "u2", email: "bob@b.co" };
    accountMock.accountView.mockResolvedValueOnce({ configured: true, user: bob });
    tableMock.maybeSingle.mockResolvedValueOnce({ data: { user_id: "u2" } });
    expect(await admin.requireSuperAdminWeft()).toEqual({ email: "bob@b.co", user: bob });
  });

  it("calls notFound() when the Weft account is signed out", async () => {
    accountMock.accountView.mockResolvedValueOnce({ configured: true, user: null });
    await expect(admin.requireSuperAdminWeft()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(navMock.notFound).toHaveBeenCalled();
  });

  it("calls notFound() when the email is on neither the allowlist nor the table", async () => {
    accountMock.accountView.mockResolvedValueOnce({ configured: true, user: { ...ADA, email: "rando@b.co" } });
    await expect(admin.requireSuperAdminWeft()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("calls notFound() when the account has no email at all", async () => {
    accountMock.accountView.mockResolvedValueOnce({ configured: true, user: { ...ADA, email: null } });
    await expect(admin.requireSuperAdminWeft()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("isAdminWeft", () => {
  it("returns true when the signed-in Weft account is on the allowlist", async () => {
    accountMock.accountView.mockResolvedValueOnce({ configured: true, user: ADA });
    expect(await admin.isAdminWeft()).toBe(true);
  });

  it("returns true for an account with a super_admins row", async () => {
    accountMock.accountView.mockResolvedValueOnce({ configured: true, user: { ...ADA, id: "u2", email: "bob@b.co" } });
    tableMock.maybeSingle.mockResolvedValueOnce({ data: { user_id: "u2" } });
    expect(await admin.isAdminWeft()).toBe(true);
  });

  it("returns false when signed out", async () => {
    accountMock.accountView.mockResolvedValueOnce({ configured: true, user: null });
    expect(await admin.isAdminWeft()).toBe(false);
  });

  it("returns false for a non-admin email without throwing", async () => {
    accountMock.accountView.mockResolvedValueOnce({ configured: true, user: { ...ADA, email: "rando@b.co" } });
    expect(await admin.isAdminWeft()).toBe(false);
  });

  it("returns false when the table lookup throws (offline, accounts not set up)", async () => {
    accountMock.accountView.mockResolvedValueOnce({ configured: true, user: { ...ADA, email: "rando@b.co" } });
    accountMock.accountClient.mockImplementationOnce(() => {
      throw new Error("Weft accounts aren't set up in this build yet.");
    });
    expect(await admin.isAdminWeft()).toBe(false);
  });
});

describe("adminServiceClient", () => {
  it("returns a service client when SUPABASE_SECRET_KEY is set", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
    const client = await admin.adminServiceClient();
    expect(client).not.toBeNull();
  });

  it("returns null when SUPABASE_SECRET_KEY is missing (the desktop case)", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(await admin.adminServiceClient()).toBeNull();
  });
});

describe("adminSessionFrom", () => {
  it("returns id, email, and a name (falling back to email)", () => {
    expect(admin.adminSessionFrom(ADA)).toEqual({ id: "u1", email: "ada@b.co", name: "Ada" });
    expect(admin.adminSessionFrom({ ...ADA, name: null })).toEqual({ id: "u1", email: "ada@b.co", name: "ada@b.co" });
  });
});
