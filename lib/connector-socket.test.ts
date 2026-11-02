// The worker daemon's connector socket (lib/connector-socket.ts): the repo from a github.com remote, one answer per
// JSON line, and a real Unix socket at mode 600 that's gone once closed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindCap, setConnectorSetup, withConnectorEnv } from "./connector-env";
import { answer, repoOfRemote, startConnectorSocket, type SocketDeps } from "./connector-socket";

afterEach(() => setConnectorSetup(null));

function deps(over: Partial<SocketDeps> = {}): SocketDeps {
  return {
    socket: "/unused",
    client: { get: vi.fn(() => Promise.resolve({ token: "ghu_t", login: "alex", expiresAt: Date.parse("2026-11-02T12:00:00Z"), asks: ["protected_push"] })), forget: vi.fn() },
    cwdOf: () => "/work/card",
    repoOf: () => Promise.resolve("owner/repo"),
    gh: { path: "/usr/bin/gh", searchPath: "/usr/bin:/bin" },
    log: vi.fn(),
    peerOf: () => Promise.resolve(4242),
    descends: (pid, cli) => Promise.resolve(pid === 4242 && cli === CLI_PID),
    ...over,
  };
}

const CLI_PID = 777;
// A stand-in for the accepted connection; the peer checks are stubbed in deps().
const CONN = {} as net.Socket;

// A capability for card c1, as a running session's env would carry it (bound to its CLI's pid unless `bound` is false).
function capFor(card: string | null = "c1", bound = true) {
  setConnectorSetup({ socket: "/s", node: "/n", helper: "/h", binDir: "/b", boxHelpers: [] });
  const env = withConnectorEnv({}, () => card ?? undefined);
  if (bound) bindCap(env, CLI_PID);
  return env.WEFT_CONNECTOR_CAP;
}

describe("repoOfRemote", () => {
  it.each([
    ["https://github.com/owner/repo", "owner/repo"],
    ["https://github.com/owner/repo.git", "owner/repo"],
    ["https://github.com/owner/repo/\n", "owner/repo"],
    ["https://x-access-token@github.com/o.n/r_e-1.git", "o.n/r_e-1"],
    ["git@github.com:owner/repo.git", "owner/repo"],
    ["ssh://git@github.com/owner/repo", "owner/repo"],
    ["https://gitlab.com/owner/repo", null],
    ["https://github.com/owner", null],
    ["https://evil.com/github.com/owner/repo", null],
  ])("%s → %s", (url, want) => expect(repoOfRemote(url)).toBe(want));
});

describe("answer", () => {
  it("refuses a line that isn't JSON, and a capability it doesn't know", async () => {
    expect(await answer(deps(), "{nope")).toEqual({ error: "Bad request." });
    expect((await answer(deps(), JSON.stringify({ cap: "x", op: "get" }))).error).toMatch(/isn't a card's session/);
    expect((await answer(deps(), JSON.stringify({ cap: capFor(null), op: "get" }))).error).toMatch(/isn't a card's session/);
  });

  it("answers a capability only to a process under the CLI it was handed to", async () => {
    const line = (cap: string | undefined) => JSON.stringify({ cap, op: "get" });
    const other = /belongs to another session/;
    expect((await answer(deps(), line(capFor("c1", false)), CONN)).error).toMatch(other);
    expect((await answer(deps(), line(capFor()))).error).toMatch(other);
    expect((await answer(deps({ peerOf: () => Promise.resolve(null) }), line(capFor()), CONN)).error).toMatch(other);
    expect((await answer(deps({ peerOf: () => Promise.resolve(9) }), line(capFor()), CONN)).error).toMatch(other);
    expect((await answer(deps({ peerOf: () => Promise.resolve(process.pid), descends: undefined }), line(capFor()), CONN)).error).toMatch(other);
    expect((await answer(deps(), line(capFor()), CONN)).token).toBe("ghu_t");
  });

  it("answers nothing once the helper or gh wrapper changed on disk", async () => {
    const d = deps({ intact: () => false });
    expect((await answer(d, JSON.stringify({ cap: capFor(), op: "get" }), CONN)).error).toMatch(/changed since it started/);
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("changed on disk"));
    expect((await answer(deps({ intact: () => true }), JSON.stringify({ cap: capFor(), op: "get" }), CONN)).token).toBe("ghu_t");
  });

  it("forgets the card's token on erase", async () => {
    const d = deps();
    expect(await answer(d, JSON.stringify({ cap: capFor(), op: "erase" }), CONN)).toEqual({ ok: true });
    expect(d.client.forget).toHaveBeenCalledWith("c1");
  });

  it("asks for get or erase", async () => {
    expect(await answer(deps(), JSON.stringify({ cap: capFor(), op: "store" }), CONN)).toEqual({ error: "Ask for get or erase." });
  });

  it("needs the card's checkout and its github.com origin", async () => {
    const repoOf = vi.fn(() => Promise.resolve("o/r"));
    expect((await answer(deps({ cwdOf: () => undefined, repoOf }), JSON.stringify({ cap: capFor(), op: "get" }), CONN)).error).toMatch(/no github.com origin/);
    expect(repoOf).not.toHaveBeenCalled();
    expect((await answer(deps({ repoOf: () => Promise.resolve(null) }), JSON.stringify({ cap: capFor(), op: "get" }), CONN)).error).toMatch(/no github.com origin/);
  });

  it("hands back the token with the real gh and its PATH", async () => {
    const d = deps();
    expect(await answer(d, JSON.stringify({ cap: capFor(), op: "get" }), CONN)).toEqual({ token: "ghu_t", login: "alex", expiresAt: "2026-11-02T12:00:00.000Z", asks: ["protected_push"], gh: "/usr/bin/gh", path: "/usr/bin:/bin" });
    expect(d.client.get).toHaveBeenCalledWith("c1", "owner/repo");
  });

  it("passes the client's refusal on and logs it", async () => {
    const d = deps({ client: { get: vi.fn(async () => Promise.reject(new Error("Not allowed."))), forget: vi.fn() } });
    expect(await answer(d, JSON.stringify({ cap: capFor("abcdefghijkl"), op: "get" }), CONN)).toEqual({ error: "Not allowed." });
    expect(d.log).toHaveBeenCalledWith("Weft Worker: GitHub token for card abcdefgh refused: Not allowed.");
  });
});

describe("startConnectorSocket", () => {
  const listening = (p: string) => vi.waitFor(() => expect(fs.statSync(p).mode & 0o777).toBe(0o600));
  const talk = (p: string, line: string) =>
    new Promise<string>((resolve, reject) => {
      const c = net.createConnection(p);
      let buf = "";
      c.setEncoding("utf8");
      c.on("data", (s: string) => (buf += s));
      c.on("end", () => resolve(buf));
      c.on("close", () => resolve(buf));
      c.on("error", reject);
      c.write(line);
    });

  it("answers one JSON line at mode 600, and is gone once closed", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wcs-"));
    const socket = path.join(dir, "c.sock");
    fs.writeFileSync(socket, "stale");
    const s = startConnectorSocket(deps({ socket }));
    await listening(socket);
    expect(JSON.parse(await talk(socket, `${JSON.stringify({ cap: capFor(), op: "erase" })}\n`))).toEqual({ ok: true });
    expect(JSON.parse(await talk(socket, "nope\n"))).toEqual({ error: "Bad request." });
    expect(await talk(socket, "x".repeat(5_000))).toBe("");
    s.close();
    expect(fs.existsSync(socket)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("waits for the newline, and logs a socket that can't listen", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wcs-"));
    const socket = path.join(dir, "c.sock");
    const s = startConnectorSocket(deps({ socket }));
    await listening(socket);
    const reply = new Promise<string>((resolve) => {
      const c = net.createConnection(socket);
      let buf = "";
      c.setEncoding("utf8");
      c.on("data", (d: string) => (buf += d));
      c.on("end", () => resolve(buf));
      c.write('{"op":');
      setTimeout(() => c.write('"x"}\n'), 20);
    });
    expect((JSON.parse(await reply) as { error: string }).error).toMatch(/isn't a card's session/);
    s.close();
    const log = vi.fn();
    const bad = startConnectorSocket(deps({ socket: path.join(dir, "missing", "c.sock"), log }));
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringMatching(/^Weft Worker: connector socket: /)));
    bad.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads the repo from the card's own origin, and lives through a caller that hangs up early", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wcs-"));
    const repo = path.join(dir, "r");
    fs.mkdirSync(repo);
    execFileSync("git", ["init", "-q", repo]);
    execFileSync("git", ["-C", repo, "remote", "add", "origin", "git@github.com:own/rep.git"]);
    let release = () => {};
    const get = vi.fn(() => new Promise<{ token: string; login: string; expiresAt: number; asks: string[] }>((resolve) => (release = () => resolve({ token: "t", login: "l", expiresAt: 0, asks: [] }))));
    const socket = path.join(dir, "c.sock");
    const d = deps({ socket, cwdOf: (id) => (id === "c1" ? repo : path.join(dir, "none")), repoOf: undefined, client: { get, forget: vi.fn() } });
    const s = startConnectorSocket(d);
    await listening(socket);
    expect((await talk(socket, `${JSON.stringify({ cap: capFor("c2"), op: "get" })}\n`)).length).toBeGreaterThan(0);
    const c = net.createConnection(socket);
    c.write(`${JSON.stringify({ cap: capFor(), op: "get" })}\n`);
    await vi.waitFor(() => expect(get).toHaveBeenCalledWith("c1", "own/rep"));
    c.destroy();
    await new Promise((r) => setTimeout(r, 20));
    release();
    await new Promise((r) => setTimeout(r, 20));
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads the peer from the OS by default, and refuses this process asking for a session's token", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wcs-"));
    const socket = path.join(dir, "c.sock");
    const s = startConnectorSocket(deps({ socket, peerOf: undefined, descends: undefined }));
    await listening(socket);
    expect((JSON.parse(await talk(socket, `${JSON.stringify({ cap: capFor(), op: "get" })}\n`)) as { error: string }).error).toMatch(/belongs to another session/);
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("drops a connection that errors", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wcs-"));
    const socket = path.join(dir, "c.sock");
    const real = net.createServer;
    let conn: net.Socket | undefined;
    const spy = vi.spyOn(net, "createServer").mockImplementation(((listener: (c: net.Socket) => void) => real((c) => listener((conn = c)))) as typeof net.createServer);
    const s = startConnectorSocket(deps({ socket }));
    spy.mockRestore();
    await listening(socket);
    const c = net.createConnection(socket);
    await vi.waitFor(() => expect(conn).toBeDefined());
    conn!.emit("error", new Error("EPIPE"));
    expect(conn!.destroyed).toBe(true);
    c.destroy();
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
