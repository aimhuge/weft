import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Callback = (err: Error | null, stdout: string, stderr: string) => void;

// A stand-in for the child process the Terminal login polls with.
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
  // The status check and the osascript call; each test scripts how they answer.
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

function lastPublished() {
  return bus.publish.mock.calls.map(([event]) => (event as { login: { state?: string; output?: string } }).login).at(-1);
}

function child(i = -1) {
  return cp.children.at(i)!;
}

function statusSays(stdout: string, stderr = "", err: Error | null = null) {
  cp.status.mockImplementation((cb) => cb(err, stdout, stderr));
}

// The command Terminal was asked to run: the `do script "…"` line of the AppleScript.
function scriptRun(): string {
  const args = cp.execFile.mock.calls.at(-1)?.[1] as string[] | undefined;
  return (args ?? []).find((line) => line.startsWith("do script")) ?? "";
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

describe("openLoginInTerminal", () => {
  it("asks Terminal to run the login, quoting the CLI path for the shell and AppleScript", () => {
    cp.which.mockReturnValue(`/Users/o'neil/my "bin"/claude`);
    const view = login.openLoginInTerminal("claude");

    expect(cp.execFile).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      [
        "-e",
        'tell application "Terminal"',
        "-e",
        String.raw`do script "'/Users/o'\\''neil/my \"bin\"/claude' auth login"`,
        "-e",
        "activate",
        "-e",
        "end tell",
      ],
      { timeout: 30_000 },
    );
    expect(view.state).toBe("terminal");
    expect(view.output).toBe(`\nOpened Terminal to run: '/Users/o'\\''neil/my "bin"/claude' auth login\n`);
    expect(lastPublished()).toEqual(view);
  });

  it("polls auth status every 3s and finishes once logged in", async () => {
    const onDone = vi.fn();
    login.openLoginInTerminal("claude", onDone);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(cp.status).toHaveBeenCalledTimes(1);
    expect(lastPublished()?.state).toBe("terminal");

    statusSays('{"loggedIn":true}');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(lastPublished()?.state).toBe("done");
    expect(onDone).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(9_000);
    expect(cp.status).toHaveBeenCalledTimes(2);
  });

  it("skips a poll while the previous status check is still out", async () => {
    let answer: Callback | undefined;
    cp.status.mockImplementation((cb) => {
      answer = cb;
    });
    login.openLoginInTerminal("claude");
    await vi.advanceTimersByTimeAsync(9_000);
    expect(cp.status).toHaveBeenCalledTimes(1);

    answer!(null, '{"loggedIn":false}', "");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(cp.status).toHaveBeenCalledTimes(2);
  });

  it("doesn't finish a login cancelled while a poll was out", async () => {
    const onDone = vi.fn();
    let answer: Callback | undefined;
    cp.status.mockImplementation((cb) => {
      answer = cb;
    });
    login.openLoginInTerminal("claude", onDone);
    await vi.advanceTimersByTimeAsync(3_000);
    login.cancelLogin("claude");
    answer!(null, '{"loggedIn":true}', "");
    await flush();

    expect(lastPublished()?.state).toBe("cancelled");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("gives up after 10 minutes", async () => {
    login.openLoginInTerminal("claude");
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 3_000);
    expect(lastPublished()?.state).toBe("failed");
    expect(lastPublished()?.output).toContain("Stopped waiting for the Terminal login after 10 minutes.");

    const checks = cp.status.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(cp.status).toHaveBeenCalledTimes(checks);
  });

  it("joins a Terminal login already waiting", async () => {
    const first = vi.fn();
    const second = vi.fn();
    login.openLoginInTerminal("claude", first);
    login.openLoginInTerminal("claude", second);
    expect(cp.osascript).toHaveBeenCalledTimes(1);

    // startLogin joins it too, rather than spawning a CLI.
    expect(login.startLogin("claude").state).toBe("terminal");
    expect(cp.spawn).not.toHaveBeenCalled();

    statusSays('{"loggedIn":true}');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("replaces a running in-app login, killing its CLI", () => {
    login.startLogin("claude");
    login.openLoginInTerminal("claude");
    expect(child().kill).toHaveBeenCalledTimes(1);
    expect(login.loginRuns()).toHaveLength(1);
    expect(login.loginRuns()[0]!.state).toBe("terminal");
  });

  it.each([
    ["the error output", "execution error: not allowed (-1743)\n", "Couldn't open Terminal: execution error: not allowed (-1743)"],
    ["the error when there's no output", "  ", "Couldn't open Terminal: osascript timed out"],
  ])("fails with %s when osascript fails", (_name, stderr, note) => {
    cp.osascript.mockImplementation((cb) => cb(new Error("osascript timed out"), "", stderr));
    login.openLoginInTerminal("claude");
    expect(lastPublished()?.state).toBe("failed");
    expect(lastPublished()?.output).toContain(note);
  });

  it("ignores an osascript failure that lands after the login was cancelled", () => {
    let answer: Callback | undefined;
    cp.osascript.mockImplementation((cb) => {
      answer = cb;
    });
    login.openLoginInTerminal("claude");
    login.cancelLogin("claude");
    answer!(new Error("late"), "", "");
    expect(lastPublished()?.state).toBe("cancelled");
  });

  it("fails off macOS", () => {
    setPlatform("linux");
    const view = login.openLoginInTerminal("claude");
    expect(view).toMatchObject({ state: "failed", output: "\nLogging in through Terminal only works on macOS.\n" });
    expect(cp.execFile).not.toHaveBeenCalled();
  });

  it("fails when the CLI isn't on PATH", () => {
    cp.which.mockReturnValue("");
    const view = login.openLoginInTerminal("puku");
    expect(view).toMatchObject({
      backend: "puku",
      state: "failed",
      output: "\npuku-cli isn't on this app's PATH, so it can't log in.\n",
    });
  });

  it("runs Goose's own configure wizard, not an auth login", () => {
    cp.which.mockReturnValue("/usr/local/bin/goose\n");
    const view = login.openLoginInTerminal("goose");

    // Goose has no `goose auth`: its login is the interactive `configure` wizard.
    expect(scriptRun()).toContain("'/usr/local/bin/goose' configure");
    expect(scriptRun()).not.toContain("auth login");
    expect(view.state).toBe("terminal");
  });

  it("runs Codex's device auth, not a plain login", () => {
    cp.which.mockReturnValue("/usr/local/bin/codex\n");
    const view = login.openLoginInTerminal("codex");

    expect(scriptRun()).toContain("'/usr/local/bin/codex' login --device-auth");
    expect(scriptRun()).not.toContain("auth login");
    expect(view.state).toBe("terminal");
  });
});
