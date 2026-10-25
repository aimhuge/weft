// /lib/admin.ts — the Weft super-admin gate. requireSuperAdminWeft reads the
// Weft account, hands the email to @aimhuge/admin's requireSuperAdmin, and
// either returns { email, user } or short-circuits with notFound() (which
// `next/navigation` throws — we mock it to throw NEXT_NOT_FOUND).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adminPkg = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(),
  isAdminCaller: vi.fn(),
}));

const accountMock = vi.hoisted(() => ({
  accountView: vi.fn(),
  accountClient: vi.fn(),
  toAccountUser: vi.fn(),
}));

const navMock = vi.hoisted(() => ({ notFound: vi.fn() }));

vi.mock("@aimhuge/admin", () => adminPkg);
vi.mock("./account", () => accountMock);
vi.mock("next/navigation", () => navMock);
vi.mock("next/server", () => ({ connection: async () => {} }));

const admin = await import("./admin");

const ADA = { id: "u1", email: "ada@b.co", name: "Ada", avatar: null, provider: "github" };

beforeEach(() => {
  vi.clearAllMocks();
  navMock.notFound.mockImplementation(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
  // The package's requireSuperAdmin normalizes & checks; mirror its return.
  adminPkg.requireSuperAdmin.mockImplementation((caller: { email: string | null }) => {
    if (!caller.email || caller.email !== "ada@b.co") {
      navMock.notFound();
    }
    return caller.email ?? "";
  });
  adminPkg.isAdminCaller.mockImplementation((caller: { email: string | null }) => Boolean(caller.email) && caller.email === "ada@b.co");
  accountMock.toAccountUser.mockImplementation((u: typeof ADA) => u);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requireSuperAdminWeft", () => {
  it("returns the normalized email and the Weft account when the caller is a super-admin", async () => {
    accountMock.accountView.mockResolvedValueOnce({ configured: true, user: ADA });
    const result = await admin.requireSuperAdminWeft();
    expect(result).toEqual({ email: "ada@b.co", user: ADA });
    expect(adminPkg.requireSuperAdmin).toHaveBeenCalledWith({ email: "ada@b.co" });
  });

  it("calls notFound() when the Weft account is signed out", async () => {
    accountMock.accountView.mockResolvedValueOnce({ configured: true, user: null });
    await expect(admin.requireSuperAdminWeft()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(navMock.notFound).toHaveBeenCalled();
  });

  it("calls notFound() when the email is not on the super-admin allowlist", async () => {
    accountMock.accountView.mockResolvedValueOnce({ configured: true, user: { ...ADA, email: "rando@b.co" } });
    await expect(admin.requireSuperAdminWeft()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(adminPkg.requireSuperAdmin).toHaveBeenCalledWith({ email: "rando@b.co" });
  });

  it("calls notFound() when the account has no email at all", async () => {
    accountMock.accountView.mockResolvedValueOnce({ configured: true, user: { ...ADA, email: null } });
    await expect(admin.requireSuperAdminWeft()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(adminPkg.requireSuperAdmin).toHaveBeenCalledWith({ email: null });
  });
});

describe("isAdminWeft", () => {
  it("returns true when the signed-in Weft account is on the allowlist", async () => {
    accountMock.accountView.mockResolvedValueOnce({ configured: true, user: ADA });
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
