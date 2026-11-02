import { describe, expect, it, vi } from "vitest";
import { loginShell, shellEnv, spawnPty } from "./worker-pty";

describe("spawnPty", () => {
  it("starts a login shell in the folder and passes its pty through", () => {
    let data: (d: string) => void = () => {};
    let exit: (e: { exitCode: number }) => void = () => {};
    const proc = { onData: (fn: typeof data) => (data = fn), onExit: (fn: typeof exit) => (exit = fn), write: vi.fn(), resize: vi.fn(), kill: vi.fn() };
    const spawn = vi.fn(() => proc);
    const pty = spawnPty("/w/app", 80, 24, () => ({ spawn }));
    expect(spawn).toHaveBeenCalledWith(loginShell(process.env), ["-l"], expect.objectContaining({ cwd: "/w/app", cols: 80, rows: 24, name: "xterm-256color" }));
    const got: string[] = [];
    const codes: number[] = [];
    pty.onData((d) => got.push(d));
    pty.onExit((c) => codes.push(c));
    data("hi");
    exit({ exitCode: 3 });
    pty.write("ls\r");
    pty.resize(100, 30);
    pty.kill();
    expect(got).toEqual(["hi"]);
    expect(codes).toEqual([3]);
    expect(proc.write).toHaveBeenCalledWith("ls\r");
    expect(proc.resize).toHaveBeenCalledWith(100, 30);
    expect(proc.kill).toHaveBeenCalled();
  });

  it("uses $SHELL, else a default per platform", () => {
    expect(loginShell({ SHELL: "/bin/zsh" })).toBe("/bin/zsh");
    expect(loginShell({}, "linux")).toBe("/bin/bash");
    expect(loginShell({}, "win32")).toBe("powershell.exe");
  });

  it("loads node-pty by default", () => {
    expect(() => spawnPty("/nonexistent-weft-dir", 80, 24)).toThrow();
  });
});

describe("shellEnv", () => {
  it("keeps the daemon's own settings and credentials out of the shell", () => {
    const env = { PATH: "/bin", HOME: "/h", LANG: "en", WEFT_WORKER: "1", SUPABASE_URL: "u", GITHUB_TOKEN: "t", AWS_SECRET: "s", API_KEY: "k", CLAUDE_CODE_OAUTH_TOKEN: "o", ANTHROPIC_API_KEY: "a" };
    expect(shellEnv(env)).toEqual({ PATH: "/bin", HOME: "/h", LANG: "en", TERM: "xterm-256color" });
    const more = { GH_PAT: "p", GOOGLE_APPLICATION_CREDENTIALS: "/c.json", DATABASE_URL: "postgres://x", REDIS: "redis://u:pw@h:6379", MIRROR: "https://tok@git.example", SITE: "https://example.com/a@b", EDITOR: "vim" };
    expect(shellEnv(more)).toEqual({ SITE: "https://example.com/a@b", EDITOR: "vim", TERM: "xterm-256color" });
  });
});
