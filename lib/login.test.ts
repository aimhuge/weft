import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoginView } from "./types";

type Callback = (err: Error | null, stdout: string, stderr: string) => void;

// A stand-in for the `auth login` child process: tests push output and exits through its emitters.
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), { writable: true, write: vi.fn() });
  pid: number | undefined = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill = vi.fn();
}

const cp = vi.hoisted(() => ({
  which: vi.fn<(file: string, args: string[]) => string>(),
  spawn: vi.fn<(...args: unknown[]) => FakeChild>(),
  children: [] as FakeChild[],
  // `auth status --json` and osascript calls; each test scripts how they answer.
  status: vi.fn<(cb: Callback) => void>(),
  osascript: vi.fn<(cb: Callback) => void>(),
  execFile: vi.fn(),
}));
const bus = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock("node:child_process", () => ({
  execFileSync: (file: string, args: string[]) => cp.which(file, args),
  spawn: (...args: unknown[]) => cp.spawn(...args),
  execFile: (file: string, args: string[], opts: unknown, cb: Callback) => {
    cp.execFile(file, args, opts);
    if (file === "/usr/bin/osascript") cp.osascript(cb);
    else cp.status(cb);
  },
}));
vi.mock("./bus", () => ({ publish: bus.publish }));

let login: typeof import("./login");
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;

function setPlatform(value: string) {
  Object.defineProperty(process, "platform", { ...platform, value });
}

// Lets the async exit handling (status check, then the state change) run to the end.
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function published(): LoginView[] {
  return bus.publish.mock.calls.map(([event]) => (event as { login: LoginView }).login);
}

function lastPublished() {
  return published().at(-1);
}

function child(i = -1) {
  return cp.children.at(i)!;
}

function statusSays(stdout: string, stderr = "", err: Error | null = null) {
  cp.status.mockImplementation((cb) => cb(err, stdout, stderr));
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  delete (globalThis as { __weftLogins?: unknown }).__weftLogins;
  cp.children = [];
  cp.which.mockReset().mockImplementation((_file, [command]) => `/usr/local/bin/${command}\n`);
  cp.spawn.mockReset().mockImplementation(() => {
    const c = new FakeChild();
    cp.children.push(c);
    return c;
  });
  cp.status.mockReset();
  statusSays('{"loggedIn":false}');
  cp.osascript.mockReset().mockImplementation((cb) => cb(null, "", ""));
  cp.execFile.mockReset();
  bus.publish.mockReset();
  setPlatform("darwin");
  login = await import("./login");
});

afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("isNotLoggedInError", () => {
  it.each(["Not logged in", "Please run /login", "Invalid API key", "OAuth token has expired", "authentication_error"])(
    "spots %j",
    (text) => {
      expect(login.isNotLoggedInError(`Error: ${text} · try again`)).toBe(true);
    },
  );

  it("ignores other errors", () => {
    expect(login.isNotLoggedInError("rate_limit_error: slow down")).toBe(false);
  });
});

describe("startLogin", () => {
  it("spawns `<cli> auth login` with the CLI env and publishes a running login", () => {
    const view = login.startLogin("claude");

    expect(cp.which).toHaveBeenCalledWith("/usr/bin/which", ["claude"]);
    expect(cp.spawn).toHaveBeenCalledWith("/usr/local/bin/claude", ["auth", "login"], {
      env: expect.objectContaining({ CLAUDE_CODE_ENTRYPOINT: "sdk-ts" }) as unknown,
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(view).toEqual({ backend: "claude", state: "running", output: "", startedAt: Date.now() });
    expect(lastPublished()).toEqual(view);
  });

  it("runs puku-cli for the puku backend", () => {
    login.startLogin("puku");
    expect(cp.which).toHaveBeenCalledWith("/usr/bin/which", ["puku-cli"]);
    expect(cp.spawn.mock.calls[0]![0]).toBe("/usr/local/bin/puku-cli");
  });

  it("looks the CLI up on PATH only once", () => {
    login.startLogin("claude");
    login.cancelLogin("claude");
    login.startLogin("claude");
    expect(cp.which).toHaveBeenCalledTimes(1);
    expect(cp.spawn).toHaveBeenCalledTimes(2);
  });

  it("throws when the CLI isn't on PATH", () => {
    cp.which.mockImplementation(() => {
      throw new Error("not found");
    });
    expect(() => login.startLogin("claude")).toThrow("claude isn't on this app's PATH, so it can't log in.");
    cp.which.mockReturnValue("  \n");
    expect(() => login.startLogin("puku")).toThrow("puku-cli isn't on this app's PATH");
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it("joins a login already running instead of starting a second one", async () => {
    const first = vi.fn();
    const second = vi.fn();
    login.startLogin("claude", first);
    const view = login.startLogin("claude", second);
    login.startLogin("claude");

    expect(view.state).toBe("running");
    expect(cp.spawn).toHaveBeenCalledTimes(1);
    statusSays('{"loggedIn":true}');
    child().emit("close", 0, null);
    await flush();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  // GitHub issue #13: a card that hit an auth wall started its own login while the user was in
  // the middle of one. The second start retired the first and killed its `auth login` process,
  // so the credential never landed and the two logins fought each other.
  it("never kills a login that is still running", async () => {
    const user = vi.fn();
    const card = vi.fn();
    login.startLogin("claude", user);
    const running = child();

    // The card hits an auth wall and asks for a login of its own.
    const view = login.startLogin("claude", card);

    expect(view.state).toBe("running");
    expect(cp.spawn).toHaveBeenCalledTimes(1);
    expect(running.kill).not.toHaveBeenCalled();

    // The one login that was already under way still finishes, and both waiters are let go.
    statusSays('{"loggedIn":true}');
    running.emit("close", 0, null);
    await flush();
    expect(user).toHaveBeenCalledTimes(1);
    expect(card).toHaveBeenCalledTimes(1);
    expect(running.kill).not.toHaveBeenCalled();
  });

  it("publishes output at most every 200ms, cleaned of terminal codes", async () => {
    login.startLogin("claude");
    bus.publish.mockClear();

    child().stdout.emit("data", Buffer.from("\x1b]0;Claude\x07\x1b[1;32mWelcome\x1b[0m   \r\n"));
    child().stderr.emit("data", Buffer.from("step\x08\x7f one\x1b(B\rtwo\n\n\n\n\nthree"));
    await vi.advanceTimersByTimeAsync(199);
    expect(bus.publish).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(bus.publish).toHaveBeenCalledTimes(1);
    expect(lastPublished()?.output).toBe("Welcome\nstep one\ntwo\n\nthree");

    // Long after the last publish, the next chunk goes out on the next tick.
    await vi.advanceTimersByTimeAsync(500);
    child().stdout.emit("data", Buffer.from("!"));
    await vi.advanceTimersByTimeAsync(0);
    expect(bus.publish).toHaveBeenCalledTimes(2);
    expect(lastPublished()?.output).toBe("Welcome\nstep one\ntwo\n\nthree!");
  });

  it("picks the login URL from a terminal hyperlink over plain text", async () => {
    login.startLogin("claude");
    child().stdout.emit(
      "data",
      Buffer.from("Open \x1b]8;;https://claude.ai/oauth?code=abc\x07this link\x1b]8;;\x07 or https://example.com/other"),
    );
    await vi.advanceTimersByTimeAsync(200);
    expect(lastPublished()?.url).toBe("https://claude.ai/oauth?code=abc");
    expect(lastPublished()?.output).toBe("Open this link or https://example.com/other");
  });

  it("falls back to the last plain URL, without trailing punctuation", async () => {
    login.startLogin("claude");
    child().stdout.emit("data", Buffer.from("Visit https://a.example/first or (https://claude.ai/login?x=1).\n"));
    await vi.advanceTimersByTimeAsync(200);
    expect(lastPublished()?.url).toBe("https://claude.ai/login?x=1");
  });

  it("keeps a URL once seen and shows only the last 8KB of output", async () => {
    login.startLogin("claude");
    child().stdout.emit("data", Buffer.from("Go to https://claude.ai/login\n"));
    await vi.advanceTimersByTimeAsync(200);
    child().stdout.emit("data", Buffer.from("x".repeat(9000)));
    await vi.advanceTimersByTimeAsync(200);

    const view = lastPublished()!;
    expect(view.url).toBe("https://claude.ai/login");
    expect(view.output).toBe("x".repeat(8 * 1024));
  });

  it("forgets raw output older than the last 32KB", async () => {
    login.startLogin("claude");
    child().stdout.emit("data", Buffer.from("https://claude.ai/old-link\n"));
    child().stdout.emit("data", Buffer.from("y".repeat(33 * 1024)));
    await vi.advanceTimersByTimeAsync(200);
    expect(lastPublished()?.url).toBeUndefined();
  });

  it("ignores a write error on stdin after the CLI exits", () => {
    login.startLogin("claude");
    expect(() => child().stdin.emit("error", new Error("EPIPE"))).not.toThrow();
  });

  it("fails when the process can't start, and ignores the close that may follow", async () => {
    login.startLogin("claude");
    const c = child();
    c.pid = undefined;
    c.emit("error", new Error("spawn EACCES"));

    expect(lastPublished()).toMatchObject({ state: "failed", output: "\nspawn EACCES\n" });
    c.emit("close", -2, null);
    await flush();
    expect(cp.status).not.toHaveBeenCalled();
    expect(lastPublished()?.state).toBe("failed");
  });

  it("shows a process error but keeps waiting when the process is running", async () => {
    login.startLogin("claude");
    child().emit("error", new Error("write EPIPE"));
    await vi.advanceTimersByTimeAsync(200);
    expect(lastPublished()).toMatchObject({ state: "running", output: "\nwrite EPIPE\n" });
  });

  it("ignores output and errors from a login that was replaced", async () => {
    login.startLogin("claude");
    const old = child();
    login.cancelLogin("claude");
    login.startLogin("claude");
    bus.publish.mockClear();

    old.stdout.emit("data", Buffer.from("stale"));
    old.pid = undefined;
    old.emit("error", new Error("stale error"));
    await vi.advanceTimersByTimeAsync(500);

    expect(bus.publish).not.toHaveBeenCalled();
    expect(login.loginRuns()[0]).toMatchObject({ state: "running", output: "" });
  });
});

describe("when auth login exits", () => {
  it("finishes the login and runs every waiting callback once the CLI reports logged in", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = vi.fn(() => {
      throw new Error("boom");
    });
    const second = vi.fn();
    login.startLogin("claude", first);
    login.startLogin("claude", second);
    statusSays('{"loggedIn":true,"email":"me@example.com"}');

    child().emit("close", 0, null);
    await flush();

    expect(cp.execFile).toHaveBeenCalledWith("/usr/local/bin/claude", ["auth", "status", "--json"], {
      env: expect.objectContaining({ CLAUDE_CODE_ENTRYPOINT: "sdk-ts" }) as unknown,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    expect(lastPublished()?.state).toBe("done");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("[login] onDone callback failed:", expect.any(Error));
    expect(child().kill).not.toHaveBeenCalled();
  });

  it("starts a fresh login once the last one finished", async () => {
    login.startLogin("claude");
    statusSays('{"loggedIn":true}');
    child().emit("close", 0, null);
    await flush();

    expect(login.startLogin("claude").state).toBe("running");
    expect(cp.spawn).toHaveBeenCalledTimes(2);
  });

  it("moves to Terminal when the CLI needs a TTY, keeping the output so far", async () => {
    const onDone = vi.fn();
    login.startLogin("claude", onDone);
    child().stderr.emit("data", Buffer.from("ERROR Raw mode is not supported on the current process.stdin\n"));
    child().emit("close", 1, null);
    await flush();

    const view = lastPublished()!;
    expect(view.state).toBe("terminal");
    expect(view.output).toContain("Raw mode is not supported");
    expect(view.output).toContain("The CLI needs a terminal for this login, so it's opening in Terminal.");
    expect(view.output).toContain("Opened Terminal to run: '/usr/local/bin/claude' auth login");
    expect(cp.osascript).toHaveBeenCalledTimes(1);

    // The callback carries over to the Terminal login.
    statusSays('{"loggedIn":true}');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it.each([
    [1, null, "auth login exited with code 1."],
    [null, "SIGTERM", "auth login stopped (SIGTERM)."],
    [null, null, "auth login exited with code unknown."],
  ] as const)("fails with a note when the CLI exits (%s, %s) still logged out", async (code, signal, note) => {
    login.startLogin("claude");
    child().emit("close", code, signal);
    await flush();
    expect(lastPublished()).toMatchObject({ state: "failed", output: `\n${note}\n` });
  });

  it("fails with the error when the status check itself throws", async () => {
    login.startLogin("claude");
    cp.status.mockImplementation(() => {
      throw new Error("spawn E2BIG");
    });
    child().emit("close", 0, null);
    await flush();
    expect(lastPublished()).toMatchObject({ state: "failed", output: "\nspawn E2BIG\n" });
  });

  it("shows a non-Error thrown by the status check as text", async () => {
    login.startLogin("claude");
    const notAnError: unknown = "status unavailable";
    cp.status.mockImplementation(() => {
      throw notAnError;
    });
    child().emit("close", 0, null);
    await flush();
    expect(lastPublished()).toMatchObject({ state: "failed", output: "\nstatus unavailable\n" });
  });

  it("stays cancelled when the login is cancelled during the status check", async () => {
    const onDone = vi.fn();
    let answer: Callback | undefined;
    cp.status.mockImplementation((cb) => {
      answer = cb;
    });
    login.startLogin("claude", onDone);
    child().emit("close", 0, null);
    await flush();
    login.cancelLogin("claude");
    answer!(null, '{"loggedIn":true}', "");
    await flush();

    expect(lastPublished()?.state).toBe("cancelled");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("ignores the exit of a cancelled login", async () => {
    login.startLogin("claude");
    login.cancelLogin("claude");
    child().emit("close", null, "SIGTERM");
    await flush();
    expect(cp.status).not.toHaveBeenCalled();
    expect(lastPublished()?.state).toBe("cancelled");
  });

  it("swallows a status failure that lands after the login was cancelled", async () => {
    let answer: Callback | undefined;
    cp.status.mockImplementation((cb) => {
      answer = cb;
    });
    login.startLogin("claude");
    child().emit("close", 0, null);
    await flush();
    login.cancelLogin("claude");
    cp.status.mockImplementation(() => {
      throw new Error("late");
    });
    answer!(null, "", "");
    await flush();
    expect(lastPublished()?.state).toBe("cancelled");
  });
});

describe("sendLoginInput", () => {
  it("writes the code and a newline to the running CLI", () => {
    login.startLogin("claude");
    login.sendLoginInput("claude", "abc-123");
    expect(child().stdin.write).toHaveBeenCalledWith("abc-123\n");
  });

  it("refuses when no login is waiting for a code", () => {
    const refusal = "No login is waiting for a code right now.";
    expect(() => login.sendLoginInput("claude", "x")).toThrow(refusal);

    login.startLogin("claude");
    child().stdin.writable = false;
    expect(() => login.sendLoginInput("claude", "x")).toThrow(refusal);

    login.cancelLogin("claude");
    expect(() => login.sendLoginInput("claude", "x")).toThrow(refusal);
  });
});

describe("cancelLogin", () => {
  it("kills the CLI and publishes the cancelled login", () => {
    login.startLogin("claude");
    login.cancelLogin("claude");
    expect(child().kill).toHaveBeenCalledTimes(1);
    expect(lastPublished()?.state).toBe("cancelled");
  });

  it("doesn't signal a CLI that already exited", () => {
    login.startLogin("claude");
    child().exitCode = 0;
    login.cancelLogin("claude");
    login.startLogin("claude");
    child().signalCode = "SIGINT";
    login.cancelLogin("claude");
    expect(cp.children.map((c) => c.kill.mock.calls.length)).toEqual([0, 0]);
  });

  it("drops a pending output publish", async () => {
    login.startLogin("claude");
    child().stdout.emit("data", Buffer.from("hello"));
    login.cancelLogin("claude");
    bus.publish.mockClear();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it("drops the callbacks of the cancelled login", async () => {
    const onDone = vi.fn();
    login.startLogin("claude", onDone);
    login.cancelLogin("claude");
    login.startLogin("claude");
    statusSays('{"loggedIn":true}');
    child().emit("close", 0, null);
    await flush();
    expect(lastPublished()?.state).toBe("done");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("leaves finished logins and unknown backends alone", async () => {
    login.cancelLogin("puku");
    login.startLogin("claude");
    statusSays('{"loggedIn":true}');
    child().emit("close", 0, null);
    await flush();
    bus.publish.mockClear();

    login.cancelLogin("claude");
    expect(bus.publish).not.toHaveBeenCalled();
    expect(login.loginRuns()[0]!.state).toBe("done");
  });
});

describe("loginRuns", () => {
  it("lists one login per backend", () => {
    expect(login.loginRuns()).toEqual([]);
    login.startLogin("claude");
    login.openLoginInTerminal("puku");
    expect(login.loginRuns().map((v) => [v.backend, v.state])).toEqual([
      ["claude", "running"],
      ["puku", "terminal"],
    ]);
  });
});

describe("authStatus", () => {
  it.each([
    ['noise {"loggedIn":true,"email":"me@example.com"} trailing', { loggedIn: true, email: "me@example.com" }],
    ['{"loggedIn":true,"email":""}', { loggedIn: true }],
    ['{"loggedIn":false,"email":42}', { loggedIn: false }],
  ])("parses the status JSON in %j", async (stdout, status) => {
    statusSays(stdout);
    await expect(login.authStatus("claude")).resolves.toEqual(status);
  });

  it("trusts the JSON even when the CLI exits non-zero", async () => {
    statusSays('{"loggedIn":false}', "", new Error("exit 1"));
    await expect(login.authStatus("claude")).resolves.toEqual({ loggedIn: false });
  });

  // Goose has no `goose auth`: its status is `goose info --check`, a text provider check.
  it("reads Goose's provider check", async () => {
    statusSays(
      [
        "goose Version:",
        "  Version:                  1.56.0",
        "",
        "Provider Check:",
        "  Provider:                 anthropic",
        "  Model:                    claude-sonnet-4-5",
        "  Auth:                     OK",
        "",
      ].join("\n"),
    );
    await expect(login.authStatus("goose")).resolves.toEqual({ loggedIn: true });
  });

  it.each([
    ["no provider configured", "  Provider:                 not configured: Configuration value not found: GOOSE_PROVIDER"],
    ["no model configured", "  Model:                    not configured: Configuration value not found: GOOSE_MODEL"],
    ["the key was refused", "  Auth:                     FAILED Authentication error: Status: 401 Unauthorized."],
  ])("reports Goose as logged out when %s", async (_name, line) => {
    statusSays(["Provider Check:", line, "Error: provider check failed"].join("\n"));
    await expect(login.authStatus("goose")).resolves.toEqual({ loggedIn: false });
  });

  it.each([
    ["no JSON", "Logged in as me"],
    ["broken JSON", "{loggedIn: true}"],
    ["braces out of order", "} {"],
    ["no loggedIn flag", '{"loggedIn":"yes"}'],
  ])("reports the CLI's stderr when its output has %s", async (_name, stdout) => {
    statusSays(stdout, "\x1b[31mError: config unreadable\x1b[0m  \n");
    await expect(login.authStatus("claude")).resolves.toEqual({ loggedIn: false, error: "Error: config unreadable" });
  });

  it("falls back to the process error, then a generic note", async () => {
    statusSays("", "", new Error("Command failed: claude auth status"));
    await expect(login.authStatus("claude")).resolves.toEqual({ loggedIn: false, error: "Command failed: claude auth status" });

    cp.status.mockImplementation((cb) => cb(null, undefined as unknown as string, undefined as unknown as string));
    await expect(login.authStatus("claude")).resolves.toEqual({ loggedIn: false, error: "No status in the CLI's output." });
  });

  it("caps the error at 500 characters", async () => {
    statusSays("", "e".repeat(800));
    const status = await login.authStatus("claude");
    expect(status.error).toHaveLength(500);
  });

  it("reports a missing CLI without running anything", async () => {
    cp.which.mockImplementation(() => {
      throw new Error("not found");
    });
    await expect(login.authStatus("puku")).resolves.toEqual({
      loggedIn: false,
      error: "puku-cli isn't on this app's PATH, so it can't log in.",
    });
    expect(cp.execFile).not.toHaveBeenCalled();
  });
});
