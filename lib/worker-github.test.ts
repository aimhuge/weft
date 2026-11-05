import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { explainClone, githubStatus, sh, signInGithub, type Fetcher, type Sh } from "./worker-github";

const TOKEN = `github_pat_${"a".repeat(30)}`;
const REPO = "https://github.com/a/b.git";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-worker-github-"));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const replying = (status: number, body: unknown = {}): Fetcher => vi.fn(() => Promise.resolve({ status, json: () => Promise.resolve(body) }));
const signedIn = replying(200, { login: "octocat" });

describe("sh", () => {
  it("feeds stdin and returns stdout", async () => {
    expect(await sh("cat", [], { input: "hello" })).toBe("hello");
  });

  it("needs no input", async () => {
    expect(await sh("echo", ["hi"])).toBe("hi\n");
  });

  it("rejects with the command's stderr", async () => {
    await expect(sh("sh", ["-c", "echo nope >&2; exit 3"])).rejects.toThrow("nope");
  });

  it("rejects with the exit code when stderr is empty", async () => {
    await expect(sh("sh", ["-c", "exit 3"])).rejects.toThrow("sh exited with 3");
  });

  it("rejects when the command is missing", async () => {
    await expect(sh("weft-no-such-command", [])).rejects.toThrow("ENOENT");
  });

  it("survives a command that exits without reading its input", async () => {
    await expect(sh("true", [], { input: "x".repeat(1 << 22) })).resolves.toBe("");
  });

  it("hides a token in the environment and stops git asking", async () => {
    vi.stubEnv("GH_TOKEN", "x");
    vi.stubEnv("GITHUB_TOKEN", "y");
    const out = await sh("sh", ["-c", 'echo "[$GH_TOKEN$GITHUB_TOKEN][$GIT_TERMINAL_PROMPT]"']);
    vi.unstubAllEnvs();
    expect(out.trim()).toBe("[][0]");
  });
});

describe("githubStatus", () => {
  const filled = (out: string): Sh => vi.fn(() => Promise.resolve(out));

  it("asks git for the credential it would use, and GitHub whose it is", async () => {
    const run = filled(`protocol=https\nhost=github.com\nusername=x\npassword=${TOKEN}\n`);
    expect(await githubStatus({ sh: run, fetcher: signedIn })).toEqual({ state: "signed_in", account: "octocat" });
    expect(run).toHaveBeenCalledWith("git", ["credential", "fill"], { input: "protocol=https\nhost=github.com\n\n" });
    const [url, init] = vi.mocked(signedIn).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/user");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("is none when git has no credential, or fails", async () => {
    expect(await githubStatus({ sh: filled("protocol=https\n"), fetcher: signedIn })).toEqual({ state: "none", account: null });
    const failing: Sh = () => Promise.reject(new Error("terminal prompts disabled"));
    expect(await githubStatus({ sh: failing, fetcher: signedIn })).toEqual({ state: "none", account: null });
  });

  it("is expired on a 401", async () => {
    expect(await githubStatus({ sh: filled(`password=${TOKEN}\n`), fetcher: replying(401) })).toEqual({ state: "expired", account: null });
  });

  it("can't say on a rate limit, a network failure or a strange answer", async () => {
    const run = filled(`password=${TOKEN}\n`);
    expect(await githubStatus({ sh: run, fetcher: replying(403) })).toBeNull();
    expect(await githubStatus({ sh: run, fetcher: () => Promise.reject(new Error("offline")) })).toBeNull();
    expect(await githubStatus({ sh: run, fetcher: replying(200, {}) })).toBeNull();
  });

  it("uses git and fetch by default", async () => {
    const fetched = vi.spyOn(globalThis, "fetch");
    vi.stubEnv("HOME", home);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
    const status = await githubStatus();
    vi.unstubAllEnvs();
    expect(status).toEqual({ state: "none", account: null });
    expect(fetched).not.toHaveBeenCalled();
    fetched.mockRestore();
  });
});

describe("signInGithub", () => {
  it("signs in with gh, on stdin, and leaves no credential file behind", async () => {
    const file = path.join(home, "github-credentials");
    fs.writeFileSync(file, "old");
    const run = vi.fn<Sh>(() => Promise.resolve(""));
    expect(await signInGithub(home, TOKEN, { sh: run, fetcher: signedIn })).toEqual({ state: "signed_in", account: "octocat" });
    expect(run).toHaveBeenNthCalledWith(1, "gh", ["auth", "login", "--hostname", "github.com", "--with-token", "--insecure-storage"], { input: `${TOKEN}\n` });
    expect(run).toHaveBeenNthCalledWith(2, "gh", ["auth", "setup-git", "--hostname", "github.com"]);
    expect(JSON.stringify(run.mock.calls.map(([, args]) => args))).not.toContain(TOKEN);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("falls back to a mode-600 credential file for github.com alone when gh is missing", async () => {
    const run = vi.fn<Sh>((cmd) => (cmd === "gh" ? Promise.reject(new Error("ENOENT")) : Promise.resolve("")));
    await signInGithub(home, TOKEN, { sh: run, fetcher: signedIn });
    const file = path.join(home, "github-credentials");
    expect(fs.readFileSync(file, "utf8")).toBe(`https://x-access-token:${TOKEN}@github.com\n`);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(run).toHaveBeenCalledWith("git", ["config", "--global", "--replace-all", "credential.https://github.com.helper", ""]);
    expect(run).toHaveBeenCalledWith("git", ["config", "--global", "--add", "credential.https://github.com.helper", `store --file="${file}"`]);
  });

  it("falls back when gh refuses the token", async () => {
    const run = vi.fn<Sh>((cmd, args) => (cmd === "gh" && args[1] === "setup-git" ? Promise.reject(new Error("no")) : Promise.resolve("")));
    await signInGithub(home, TOKEN, { sh: run, fetcher: signedIn });
    expect(fs.existsSync(path.join(home, "github-credentials"))).toBe(true);
  });

  it("refuses what isn't a GitHub token, without asking GitHub", async () => {
    const fetcher = replying(200);
    await expect(signInGithub(home, "sk-ant-nope", { sh: vi.fn(), fetcher })).rejects.toThrow("That isn't a GitHub token.");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stores nothing for a token GitHub refuses, or can't check", async () => {
    const run = vi.fn<Sh>();
    await expect(signInGithub(home, TOKEN, { sh: run, fetcher: replying(401) })).rejects.toThrow("GitHub refused that token");
    await expect(signInGithub(home, TOKEN, { sh: run, fetcher: replying(500) })).rejects.toThrow("couldn't reach GitHub");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("explainClone", () => {
  const denied = new Error("Command failed: git clone\nfatal: could not read Username for 'https://github.com': terminal prompts disabled");

  it("tells a worker with no sign-in what to do", () => {
    expect(explainClone(denied, REPO, { state: "none", account: null })).toBe(
      `This worker isn't signed in to GitHub, and ${REPO} is private or doesn't exist. Use Sign in to GitHub on its row in Settings → Sync → Workers.`,
    );
  });

  it("says when the sign-in has expired", () => {
    expect(explainClone(denied, REPO, { state: "expired", account: "octocat" })).toContain("sign-in has expired");
  });

  it("says when the account can't reach the repo", () => {
    expect(explainClone(new Error("remote: Repository not found."), REPO, { state: "signed_in", account: "octocat" })).toBe(
      `octocat can't reach ${REPO}. Give its token access to that repo, or check the name.`,
    );
    expect(explainClone(new Error("Repository not found"), REPO, { state: "signed_in", account: null })).toContain("This worker's GitHub account can't reach");
  });

  it("gives git's own last word for anything else", () => {
    expect(explainClone(new Error("Command failed\nfatal: unable to access: Could not resolve host"), REPO, { state: "none", account: null })).toBe("fatal: unable to access: Could not resolve host");
    expect(explainClone(new Error("no disk"), REPO, null)).toBe("no disk");
    expect(explainClone("odd", REPO, null)).toBe("odd");
  });

  it("doesn't guess at a sign-in it couldn't check", () => {
    expect(explainClone(denied, REPO, null)).toContain("fatal: could not read Username");
  });
});
