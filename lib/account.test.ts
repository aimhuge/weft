import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";

// lib/account.ts against a fake supabase-js client: the file storage, the user view, and each auth call.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-account-"));
process.env.WEFT_DATA = dir;
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const auth = {
  getSession: vi.fn(),
  signInWithOAuth: vi.fn(),
  signInWithOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(),
};
const createClient = vi.fn<(url: string, key: string, opts: unknown) => { auth: typeof auth }>(() => ({ auth }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
const publish = vi.fn();
vi.mock("./bus", () => ({ publish }));

async function load(key = "sb_publishable_test") {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__weftSupabase;
  vi.stubEnv("WEFT_SUPABASE_KEY", key);
  return import("./account");
}

const user = {
  id: "u1",
  email: "a@b.co",
  user_metadata: { full_name: "Ada", avatar_url: "https://img/a.png" },
  app_metadata: { provider: "github" },
} as unknown as User;

beforeEach(() => {
  vi.clearAllMocks();
  fs.rmSync(path.join(dir, "account.json"), { force: true });
});

describe("fileStorage", () => {
  it("keeps items in account.json, readable only by you", async () => {
    const { fileStorage } = await load();
    expect(fileStorage.getItem("k")).toBeNull();
    fileStorage.setItem("k", "v");
    fileStorage.setItem("j", "w");
    expect(fileStorage.getItem("k")).toBe("v");
    expect(fs.statSync(path.join(dir, "account.json")).mode & 0o777).toBe(0o600);
    fileStorage.removeItem("k");
    expect(fileStorage.read()).toEqual({ j: "w" });
  });

  it("reads a broken file as empty", async () => {
    const { fileStorage } = await load();
    fs.writeFileSync(path.join(dir, "account.json"), "{nope");
    expect(fileStorage.read()).toEqual({});
  });
});

describe("toAccountUser", () => {
  it("picks name, avatar and provider from the metadata", async () => {
    const { toAccountUser } = await load();
    expect(toAccountUser(user)).toEqual({ id: "u1", email: "a@b.co", name: "Ada", avatar: "https://img/a.png", provider: "github" });
  });

  it("falls back across keys and to null", async () => {
    const { toAccountUser } = await load();
    const google = { id: "u2", user_metadata: { name: "", user_name: "ada", picture: "p" }, app_metadata: {} } as unknown as User;
    expect(toAccountUser(google)).toEqual({ id: "u2", email: null, name: "ada", avatar: "p", provider: null });
    const bare = { id: "u3", user_metadata: {}, app_metadata: {} } as unknown as User;
    expect(toAccountUser(bare)).toEqual({ id: "u3", email: null, name: null, avatar: null, provider: null });
  });
});

describe("without a key", () => {
  it("says sign-in isn't configured and refuses to sign in", async () => {
    const account = await load("");
    expect(await account.accountView()).toEqual({ configured: false, user: null });
    await expect(account.startSignIn("github", "http://localhost:1")).rejects.toThrow("aren't set up");
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("with a key", () => {
  it("makes one PKCE client that stores the session in the file", async () => {
    const account = await load();
    auth.getSession.mockResolvedValue({ data: { session: null } });
    await account.accountView();
    await account.accountView();
    expect(createClient).toHaveBeenCalledTimes(1);
    const [url, key, opts] = createClient.mock.calls[0] as [string, string, { auth: Record<string, unknown> }];
    expect(url).toBe("https://lqjyravglujyizyqypxq.supabase.co");
    expect(key).toBe("sb_publishable_test");
    expect(opts.auth).toMatchObject({ flowType: "pkce", storage: account.fileStorage, detectSessionInUrl: false });
  });

  it("keeps the session in Electron main, behind the Keychain, inside the desktop app", async () => {
    vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:9");
    const account = await load();
    auth.getSession.mockResolvedValue({ data: { session: null } });
    await account.accountView();
    const [, , opts] = createClient.mock.calls[0] as [string, string, { auth: { storage: unknown } }];
    expect(opts.auth.storage).not.toBe(account.fileStorage);
    expect(opts.auth.storage).toHaveProperty("getItem");
    vi.stubEnv("WEFT_SHELL_URL", "");
  });

  it("shows who's signed in", async () => {
    const account = await load();
    auth.getSession.mockResolvedValue({ data: { session: { user } } });
    expect(await account.accountView()).toEqual({ configured: true, user: account.toAccountUser(user) });
  });

  it("starts OAuth with a loopback redirect and returns the page", async () => {
    const account = await load();
    auth.signInWithOAuth.mockResolvedValue({ data: { url: "https://gh/login" }, error: null });
    expect(await account.startSignIn("google", "http://127.0.0.1:3457/")).toBe("https://gh/login");
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://127.0.0.1:3457/api/auth/callback", skipBrowserRedirect: true },
    });
  });

  it("goes back through weft.zip/auth/desktop when running inside the desktop app on macOS", async () => {
    vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:9");
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
    try {
      const account = await load();
      auth.signInWithOAuth.mockResolvedValue({ data: { url: "https://gh/login" }, error: null });
      await account.startSignIn("github", "http://127.0.0.1:57598");
      expect(auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: "github",
        options: { redirectTo: "https://weft.zip/auth/desktop", skipBrowserRedirect: true },
      });
      auth.signInWithOtp.mockResolvedValue({ error: null });
      await account.sendMagicLink("a@b.co", "http://127.0.0.1:57598");
      expect(auth.signInWithOtp).toHaveBeenCalledWith({
        email: "a@b.co",
        options: { emailRedirectTo: "https://weft.zip/auth/desktop", shouldCreateUser: true },
      });
      expect(account.weftCallbackUrl()).toBe("weft://account-callback");
    } finally {
      Object.defineProperty(process, "platform", platform);
      vi.stubEnv("WEFT_SHELL_URL", "");
    }
  });

  it("comes straight back to the loopback callback inside the desktop app on Windows and Linux", async () => {
    vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:9");
    try {
      const account = await load();
      expect(account.redirectUrl("http://127.0.0.1:57598/", "win32")).toBe("http://127.0.0.1:57598/api/auth/callback");
      expect(account.redirectUrl("http://127.0.0.1:57598", "linux")).toBe("http://127.0.0.1:57598/api/auth/callback");
      expect(account.redirectUrl("http://127.0.0.1:57598", "darwin")).toBe("https://weft.zip/auth/desktop");
    } finally {
      vi.stubEnv("WEFT_SHELL_URL", "");
    }
  });

  it("refuses unknown providers, errors and a missing page", async () => {
    const account = await load();
    await expect(account.startSignIn("gitlab" as never, "http://x")).rejects.toThrow("Unknown sign-in provider");
    auth.signInWithOAuth.mockResolvedValueOnce({ data: {}, error: new Error("provider off") });
    await expect(account.startSignIn("github", "http://x")).rejects.toThrow("provider off");
    auth.signInWithOAuth.mockResolvedValueOnce({ data: { url: null }, error: null });
    await expect(account.startSignIn("github", "http://x")).rejects.toThrow("didn't return");
  });

  it("emails a magic link to a valid address", async () => {
    const account = await load();
    auth.signInWithOtp.mockResolvedValue({ error: null });
    await account.sendMagicLink("  a@b.co ", "http://localhost:9");
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "a@b.co",
      options: { emailRedirectTo: "http://localhost:9/api/auth/callback", shouldCreateUser: true },
    });
    await expect(account.sendMagicLink("nope", "http://x")).rejects.toThrow("valid email");
    auth.signInWithOtp.mockResolvedValueOnce({ error: new Error("rate limited") });
    await expect(account.sendMagicLink("a@b.co", "http://x")).rejects.toThrow("rate limited");
  });

  it("exchanges the code and tells the board", async () => {
    const account = await load();
    auth.exchangeCodeForSession.mockResolvedValue({ data: { user }, error: null });
    expect((await account.finishSignIn("c0de")).email).toBe("a@b.co");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("c0de");
    expect(publish).toHaveBeenCalledWith({ type: "account" });
  });

  it("refuses a missing or bad code", async () => {
    const account = await load();
    await expect(account.finishSignIn("")).rejects.toThrow("no code");
    auth.exchangeCodeForSession.mockResolvedValueOnce({ data: {}, error: new Error("expired") });
    await expect(account.finishSignIn("old")).rejects.toThrow("expired");
    expect(publish).not.toHaveBeenCalled();
  });

  it("signs out on this machine only", async () => {
    const account = await load();
    auth.signOut.mockResolvedValue({ error: null });
    await account.signOut();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(publish).toHaveBeenCalledWith({ type: "account" });
    auth.signOut.mockResolvedValueOnce({ error: new Error("offline") });
    await expect(account.signOut()).rejects.toThrow("offline");
  });
});
