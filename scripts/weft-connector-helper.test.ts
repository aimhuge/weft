// A worker card's git credential helper and gh wrapper (scripts/weft-connector-helper.cjs): what it asks the daemon's
// socket, what git and gh are handed, and that gh's env is built from scratch.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import helper from "./weft-connector-helper.cjs";

const { ask, parseCredential, firstCommand, ghEnv, gitCredential, gh, REFUSED } = helper;

// A connection that answers each line with `reply` (a string, or an Error to fail with), and records what was sent.
function fakeConnect(reply: string | Error | null) {
  const sent: string[] = [];
  const connect = vi.fn<(socket: string) => EventEmitter>(() => {
    const c = Object.assign(new EventEmitter(), {
      setEncoding: vi.fn(),
      write: (s: string) => {
        sent.push(s);
        queueMicrotask(() => {
          if (reply instanceof Error) return void c.emit("error", reply);
          if (reply === null) return;
          c.emit("data", reply);
          c.emit("end");
        });
      },
      destroy: (err?: Error) => err && c.emit("error", err),
    });
    queueMicrotask(() => c.emit("connect"));
    return c;
  });
  return { connect: connect as unknown as typeof net.connect & typeof connect, sent: () => sent.map((s): unknown => JSON.parse(s)) };
}

const io = (connect: unknown, spawn: unknown = vi.fn()) => ({ out: vi.fn(), err: vi.fn(), connect, spawn });
const ENV = { WEFT_CONNECTOR_SOCKET: "/s.sock", WEFT_CONNECTOR_CAP: "cap1" };
const TOKEN = JSON.stringify({ token: "ghu_t", expiresAt: "2026-11-02T12:00:00.000Z", gh: "/opt/gh", path: "/opt:/usr/bin" });

afterEach(() => vi.useRealTimers());

describe("ask", () => {
  it("sends one JSON line and reads one back", async () => {
    const f = fakeConnect('{"ok":true}');
    expect(await ask("/s.sock", { op: "erase" }, f.connect)).toEqual({ ok: true });
    expect(f.connect).toHaveBeenCalledWith("/s.sock");
    expect(f.sent()).toEqual([{ op: "erase" }]);
  });

  it("fails with no socket, an answer that isn't JSON, a connection error or no answer", async () => {
    await expect(ask(undefined, {})).rejects.toThrow("no connector socket");
    await expect(ask("/s", {}, fakeConnect("nope").connect)).rejects.toThrow("wasn't JSON");
    await expect(ask("/s", {}, fakeConnect(new Error("ECONNREFUSED")).connect)).rejects.toThrow("ECONNREFUSED");
    vi.useFakeTimers();
    const p = ask("/s", {}, fakeConnect(null).connect);
    const done = expect(p).rejects.toThrow("The worker didn't answer.");
    await vi.advanceTimersByTimeAsync(30_000);
    await done;
  });

  it("talks to a real Unix socket by default", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wch-"));
    const socket = path.join(dir, "c.sock");
    const server = net.createServer((c) => c.once("data", (d) => c.end(JSON.stringify({ got: JSON.parse(String(d)) as unknown }))));
    await new Promise<void>((r) => server.listen(socket, r));
    expect(await ask(socket, { op: "get" })).toEqual({ got: { op: "get" } });
    server.close();
    await expect(ask(path.join(dir, "missing.sock"), {})).rejects.toThrow(/ENOENT/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("parseCredential", () => {
  it("reads git's key=value lines", () => {
    expect(parseCredential("protocol=https\nhost=github.com\npath=a=b\n=x\nnoequals\n")).toEqual({ protocol: "https", host: "github.com", path: "a=b" });
  });
});

describe("firstCommand", () => {
  it.each([
    [["pr", "list"], "pr"],
    [["--hostname", "x", "auth", "token"], "auth"],
    [["-R", "o/r", "api", "user"], "api"],
    [["--repo", "o/r", "--verbose", "alias"], "alias"],
    [["--help"], null],
    [[], null],
  ])("%j → %s", (args, want) => expect(firstCommand(args)).toBe(want));
});

describe("ghEnv", () => {
  it("keeps only the allowlisted vars, with the daemon's PATH and a fresh config folder", () => {
    const env = { HOME: "/h", USER: "u", LANG: "C", TERM: "xterm", PATH: "/evil", NODE_OPTIONS: "--require x", NODE_PATH: "/x", GIT_DIR: "/g", GIT_SSH_COMMAND: "x", PAGER: "x", BROWSER: "x", EDITOR: "x", GH_BROWSER: "x", GH_TOKEN: "old", GH_HOST: "evil", GH_CONFIG_DIR: "/c", WEFT_CONNECTOR_CAP: "c", COLUMNS: 80 };
    const out = ghEnv(env, { token: "ghu_t", path: "/opt:/usr/bin" }, "/tmp/cfg");
    expect(out).toEqual({ HOME: "/h", USER: "u", LANG: "C", TERM: "xterm", PATH: "/opt:/usr/bin", GH_TOKEN: "ghu_t", GH_HOST: "github.com", GH_CONFIG_DIR: "/tmp/cfg", GH_DATA_DIR: "/tmp/cfg", XDG_CONFIG_HOME: "/tmp/cfg", XDG_DATA_HOME: "/tmp/cfg", XDG_STATE_HOME: "/tmp/cfg", XDG_CACHE_HOME: "/tmp/cfg", GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_SPINNER_DISABLED: "1", GH_PAGER: "cat", GIT_TERMINAL_PROMPT: "0" });
    expect(ghEnv({}, { token: "t" }, "/c").PATH).toBe("/usr/bin:/bin");
  });
});

describe("gitCredential", () => {
  const GH = "protocol=https\nhost=github.com\n";

  it("says nothing for any host but https://github.com", async () => {
    const f = fakeConnect(TOKEN);
    const o = io(f.connect);
    expect(await gitCredential("get", "protocol=https\nhost=gitlab.com\n", ENV, o)).toBe(0);
    expect(await gitCredential("get", "protocol=http\nhost=github.com\n", ENV, o)).toBe(0);
    expect(f.connect).not.toHaveBeenCalled();
    expect(o.out).not.toHaveBeenCalled();
  });

  it("prints the username, token and expiry on get", async () => {
    const f = fakeConnect(TOKEN);
    const o = io(f.connect);
    expect(await gitCredential("get", GH, ENV, o)).toBe(0);
    expect(f.sent()).toEqual([{ cap: "cap1", op: "get" }]);
    expect(o.out).toHaveBeenCalledWith(`username=x-access-token\npassword=ghu_t\npassword_expiry_utc=${Date.parse("2026-11-02T12:00:00.000Z") / 1000}\n`);
    const o2 = io(fakeConnect(JSON.stringify({ token: "t" })).connect);
    await gitCredential("get", GH, ENV, o2);
    expect(o2.out).toHaveBeenCalledWith("username=x-access-token\npassword=t\n");
  });

  it("says why on stderr only, when there's no token", async () => {
    for (const [reply, why] of [[JSON.stringify({ error: "Not allowed." }), "Not allowed."], ["{}", "no answer"], [new Error("ENOENT"), "ENOENT"]] as const) {
      const o = io(fakeConnect(reply).connect);
      expect(await gitCredential("get", GH, ENV, o)).toBe(0);
      expect(o.out).not.toHaveBeenCalled();
      expect(o.err).toHaveBeenCalledWith(`Weft: no GitHub token from the worker: ${why}\n`);
    }
  });

  it("asks the daemon to erase, quietly, and does nothing on store", async () => {
    const f = fakeConnect('{"ok":true}');
    expect(await gitCredential("erase", GH, ENV, io(f.connect))).toBe(0);
    expect(f.sent()).toEqual([{ cap: "cap1", op: "erase" }]);
    const o = io(fakeConnect(new Error("gone")).connect);
    expect(await gitCredential("erase", GH, ENV, o)).toBe(0);
    expect(o.err).not.toHaveBeenCalled();
    const s = fakeConnect(TOKEN);
    expect(await gitCredential("store", `${GH}password=x\n`, ENV, io(s.connect))).toBe(0);
    expect(s.connect).not.toHaveBeenCalled();
  });
});

describe("realGh", () => {
  it("finds an executable gh on PATH past the wrapper's folder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wgh-"));
    fs.writeFileSync(path.join(dir, "gh"), "#!/bin/sh\n", { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "notexec"), "x");
    expect(helper.realGh({ PATH: [helper.WRAPPER_DIR, "", dir].join(path.delimiter) })).toBe(path.join(dir, "gh"));
    expect(helper.realGh({ PATH: path.join(dir, "missing") })).toBeNull();
    expect(helper.realGh({})).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("gh", () => {
  it.each([...REFUSED])("refuses `gh %s` while the connector's token is in use", async (cmd) => {
    const f = fakeConnect(TOKEN);
    const spawn = vi.fn();
    const o = io(f.connect, spawn);
    expect(await gh(["--hostname", "github.com", cmd, "x"], ENV, o)).toBe(1);
    expect(o.err).toHaveBeenCalledWith(expect.stringContaining(`\`gh ${cmd}\` isn't available`));
    expect(spawn).not.toHaveBeenCalled();
  });

  it("lets `gh auth` through to the box's own gh when the connector has no token", async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("exit", 0));
      return child;
    });
    const o = { ...io(fakeConnect(JSON.stringify({ error: "GitHub isn't turned on." })).connect, spawn), exists: (f: string) => f === "/usr/bin/gh" };
    expect(await gh(["auth", "status"], { ...ENV, PATH: "/usr/bin" }, o)).toBe(0);
    expect(spawn).toHaveBeenCalledWith("/usr/bin/gh", ["auth", "status"], expect.anything());
  });

  it("falls back to the real gh with the card's own env when there's no token", async () => {
    for (const reply of [JSON.stringify({ error: "GitHub isn't turned on." }), "{}", new Error("ENOENT")]) {
      let seen: { cmd: string; env: Record<string, string> } | undefined;
      const spawn = vi.fn((cmd: string, _args: string[], opts: { env: Record<string, string> }) => {
        seen = { cmd, env: opts.env };
        const child = new EventEmitter();
        queueMicrotask(() => child.emit("exit", 0));
        return child;
      });
      const env = { ...ENV, PATH: [helper.WRAPPER_DIR, "/usr/local/bin", "/opt/homebrew/bin"].join(path.delimiter), HOME: "/h" };
      const o = { ...io(fakeConnect(reply).connect, spawn), exists: (f: string) => f === "/opt/homebrew/bin/gh" || f === path.join(helper.WRAPPER_DIR, "gh") };
      expect(await gh(["pr", "list"], env, o)).toBe(0);
      expect(seen).toEqual({ cmd: "/opt/homebrew/bin/gh", env });
      expect(o.err).not.toHaveBeenCalled();
    }
  });

  it("says so when there's no token and no gh on PATH, or no gh on the worker", async () => {
    const none = { ...io(fakeConnect("{}").connect), exists: () => false };
    expect(await gh(["pr", "list"], { ...ENV, PATH: "/x" }, none)).toBe(1);
    expect(none.err).toHaveBeenCalledWith("Weft: no GitHub token from the worker (no answer), and no gh on PATH.\n");
    const empty = { ...io(fakeConnect(JSON.stringify({ error: "Not allowed." })).connect), exists: () => true };
    expect(await gh(["pr"], ENV, empty)).toBe(1);
    expect(empty.err).toHaveBeenCalledWith("Weft: no GitHub token from the worker (Not allowed.), and no gh on PATH.\n");
    const o = io(fakeConnect(JSON.stringify({ token: "t", gh: null })).connect);
    expect(await gh(["pr", "list"], ENV, o)).toBe(1);
    expect(o.err).toHaveBeenCalledWith("Weft: gh isn't installed on this worker.\n");
  });

  it("runs the daemon's gh with the scrubbed env and a config folder it removes after", async () => {
    let seen: { cmd: string; args: string[]; env: Record<string, string> } | undefined;
    let existed = false;
    const spawn = vi.fn((cmd: string, args: string[], opts: { env: Record<string, string>; stdio: string }) => {
      seen = { cmd, args, env: opts.env };
      existed = fs.statSync(opts.env.GH_CONFIG_DIR!).isDirectory();
      expect(opts.stdio).toBe("inherit");
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("exit", 3));
      return child;
    });
    const env = { ...ENV, HOME: "/h", NODE_OPTIONS: "--require evil", PATH: "/evil" };
    expect(await gh(["pr", "list"], env, io(fakeConnect(TOKEN).connect, spawn))).toBe(3);
    expect(seen?.cmd).toBe("/opt/gh");
    expect(seen?.args).toEqual(["pr", "list"]);
    expect(seen?.env).toMatchObject({ HOME: "/h", PATH: "/opt:/usr/bin", GH_TOKEN: "ghu_t" });
    expect(seen?.env.NODE_OPTIONS).toBeUndefined();
    expect(existed).toBe(true);
    expect(fs.existsSync(seen!.env.GH_CONFIG_DIR!)).toBe(false);
  });

  it("answers 1 when gh exits with no code or can't start", async () => {
    const child = (event: string, value: unknown) =>
      vi.fn(() => {
        const c = new EventEmitter();
        queueMicrotask(() => c.emit(event, value));
        return c;
      });
    expect(await gh([], ENV, io(fakeConnect(TOKEN).connect, child("exit", null)))).toBe(1);
    const o = io(fakeConnect(TOKEN).connect, child("error", new Error("EACCES")));
    expect(await gh(["pr"], ENV, o)).toBe(1);
    expect(o.err).toHaveBeenCalledWith("Weft: couldn't run gh: EACCES\n");
  });
});
