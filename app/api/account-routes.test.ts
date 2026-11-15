import { beforeEach, describe, expect, it, vi } from "vitest";

// The /api/account JSON surface (GET view, POST start-signin / email / signout).
// The OAuth callback moved to /api/auth/callback (see app/api/auth/callback/route.test.ts).

// No launch token on a test run, even on a Mac where Weft is running and wrote one.
// signout-everywhere sets one to check it's elevated.
const shell = vi.hoisted(() => ({ token: "" }));
vi.mock("@/lib/shell-token", () => ({ shellToken: () => shell.token }));
vi.mock("next/server", () => ({ connection: async () => {}, after: (task: () => unknown) => void task() }));
vi.mock("@/lib/account", () => ({
  accountView: vi.fn(() => Promise.resolve({ configured: true, user: null })),
  startSignIn: vi.fn(() => Promise.resolve("https://github.com/login")),
  sendMagicLink: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
}));

const account = await import("@/lib/account");
const route = await import("./account/route");

const WRITE = { host: "127.0.0.1:3457", "x-weft-token": "1", "content-type": "application/json" };

function post(body: unknown, headers: Record<string, string> = WRITE) {
  return route.POST(new Request("http://127.0.0.1:3457/api/account", { method: "POST", headers, body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  shell.token = "";
});

describe("GET /account", () => {
  it("returns the view", async () => {
    const res = await route.GET(new Request("http://localhost/api/account", { headers: { host: "localhost:3457" } }));
    expect(await res.json()).toEqual({ configured: true, user: null });
  });

  it("refuses other hosts and reports failures", async () => {
    expect((await route.GET(new Request("http://evil/api/account", { headers: { host: "evil.com" } }))).status).toBe(403);
    vi.mocked(account.accountView).mockRejectedValueOnce(new Error("disk"));
    const res = await route.GET(new Request("http://localhost/api/account", { headers: { host: "localhost" } }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "disk" });
  });
});

describe("POST /account", () => {
  it("starts OAuth back to the origin the board used", async () => {
    expect(await (await post({ action: "oauth", provider: "github" })).json()).toEqual({ url: "https://github.com/login" });
    expect(account.startSignIn).toHaveBeenCalledWith("github", "http://127.0.0.1:3457");
  });

  it("ignores `next` from the body (handled in lib/auth rather than here)", async () => {
    await post({ action: "oauth", provider: "github", next: "/app" });
    expect(account.startSignIn).toHaveBeenCalledWith("github", "http://127.0.0.1:3457");
  });

  it("sends a magic link and signs out", async () => {
    expect((await post({ action: "email", email: "a@b.co" })).status).toBe(200);
    expect(account.sendMagicLink).toHaveBeenCalledWith("a@b.co", "http://127.0.0.1:3457");
    expect((await post({ action: "signout" })).status).toBe(200);
    expect(account.signOut).toHaveBeenCalled();
  });

  it("passes empty text for missing fields and refuses unknown actions", async () => {
    await post({ action: "email", email: 5 });
    expect(account.sendMagicLink).toHaveBeenCalledWith("", "http://127.0.0.1:3457");
    const res = await post({ action: "hack" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown account action." });
  });

  it("signs out everywhere only from Weft's own window", async () => {
    shell.token = "launch-token";
    const res = await post({ action: "signout-everywhere" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "This change needs Weft's own window" });
    expect(account.signOut).not.toHaveBeenCalled();
    const ok = await post({ action: "signout-everywhere" }, { ...WRITE, "x-weft-token": "launch-token" });
    expect(ok.status).toBe(200);
    expect(account.signOut).toHaveBeenCalledWith("global");
  });

  it("needs the write header", async () => {
    expect((await post({ action: "signout" }, { host: "127.0.0.1:3457" })).status).toBe(403);
  });
});
