import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Antigravity's side of lib/login-status.ts and lib/login.ts: its status is `agy -p /usage --output-format json`,
// a Google-account sign-in carries a warning, and its login goes to Terminal like Codex's and Goose's.

type Callback = (err: Error | null, stdout: string, stderr: string) => void;

const cp = vi.hoisted(() => ({
  status: vi.fn<(cb: Callback) => void>(),
  osascript: vi.fn<(cb: Callback) => void>(),
  execFile: vi.fn(),
}));
type Mode = "api-key" | "cloud" | "google-account";
const agy = vi.hoisted((): { path: string | null; mode: Mode } => ({ path: "/Users/me/.local/bin/agy", mode: "google-account" }));

vi.mock("node:child_process", () => ({
  execFileSync: () => "",
  spawn: vi.fn(),
  execFile: (file: string, args: string[], opts: unknown, cb: Callback) => {
    cp.execFile(file, args, opts);
    if (file === "/usr/bin/osascript") cp.osascript(cb);
    else cp.status(cb);
  },
}));
vi.mock("./bus", () => ({ publish: vi.fn() }));
vi.mock("./antigravity-login", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./antigravity-login")>()),
  antigravityBin: () => agy.path,
  antigravityAuthMode: () => agy.mode,
}));

let login: typeof import("./login");
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;

const SIGNED_IN = JSON.stringify({ conversation_id: "", status: "SUCCESS", response: "Gemini Models\tWeekly Limit Remaining\t100%" });

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  delete (globalThis as { __weftLogins?: unknown }).__weftLogins;
  cp.status.mockReset();
  cp.osascript.mockReset().mockImplementation((cb) => cb(null, "", ""));
  cp.execFile.mockReset();
  agy.path = "/Users/me/.local/bin/agy";
  agy.mode = "google-account";
  Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
  login = await import("./login");
});

afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  vi.useRealTimers();
});

describe("authStatus for Antigravity", () => {
  it("runs `agy -p /usage --output-format json` from where agy is", async () => {
    cp.status.mockImplementation((cb) => cb(null, SIGNED_IN, ""));
    agy.mode = "api-key";
    await expect(login.authStatus("antigravity")).resolves.toEqual({ loggedIn: true });
    expect(cp.execFile).toHaveBeenCalledWith("/Users/me/.local/bin/agy", ["-p", "/usage", "--output-format", "json"], expect.anything());
  });

  it("warns under a Google-account sign-in", async () => {
    cp.status.mockImplementation((cb) => cb(null, SIGNED_IN, ""));
    const status = await login.authStatus("antigravity");
    expect(status.loggedIn).toBe(true);
    expect(status.warning).toContain("can get the account suspended");
  });

  it("reads a signed-out agy as logged out, with no warning", async () => {
    cp.status.mockImplementation((cb) => cb(new Error("exit 1"), "", "Error: authentication required"));
    await expect(login.authStatus("antigravity")).resolves.toEqual({ loggedIn: false });
  });

  it("says agy isn't there when it's on neither PATH nor ~/.local/bin", async () => {
    agy.path = null;
    await expect(login.authStatus("antigravity")).resolves.toEqual({ loggedIn: false, error: "agy isn't on this app's PATH, so it can't log in." });
  });
});

describe("startLogin for Antigravity", () => {
  it("opens Terminal on `agy acp --login`", () => {
    cp.status.mockImplementation((cb) => cb(new Error("exit 1"), "", "authentication required"));
    const view = login.startLogin("antigravity");
    expect(view.state).toBe("terminal");
    const script = (cp.execFile.mock.calls.at(-1)?.[1] as string[]).find((line) => line.startsWith("do script"));
    expect(script).toContain("'/Users/me/.local/bin/agy' acp --login");
  });
});
