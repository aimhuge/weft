import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// spawn hands back a fake child the tests drive by emitting data, error and exit; fetch and
// process.kill are stubbed, so nothing really starts or gets signalled.
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
  constructor(public pid: number) {
    super();
  }
}

const children: FakeChild[] = [];
const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));

// Catch the exit hook the module installs instead of letting it reach the real process.
const exitHooks: (() => void)[] = [];
const realOn = process.on.bind(process);
vi.spyOn(process, "on").mockImplementation(((event: string, fn: () => void) => {
  if (event === "exit") exitHooks.push(fn);
  else realOn(event, fn);
  return process;
}) as typeof process.on);

// The vault's side is mocked: by default there's nothing to inject, so servers start the plain way.
const devSecrets = vi.hoisted(() => vi.fn());
vi.mock("./secret-run", () => ({ devSecrets }));
vi.mock("./env", () => ({ cliEnv: () => ({ PATH: "/bin" }) }));
// Card "iso" is isolated (docs/architecture/worktrees.md); every other id is a shared card.
vi.mock("./store", () => ({ getCard: (id: string) => (id === "iso" ? { id, worktree: { path: "/w", branch: "weft/x", base: "b", repo: "/r" } } : undefined) }));

const dev = await import("./devserver");

const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

let nextPid = 1000;
beforeEach(() => {
  spawn.mockReset().mockImplementation(() => {
    const child = new FakeChild(++nextPid);
    children.push(child);
    return child;
  });
  fetchMock.mockReset().mockRejectedValue(new Error("ECONNREFUSED"));
  devSecrets.mockReset().mockResolvedValue({});
  kill.mockClear();
});
afterEach(() => {
  for (const id of ["a", "b", "c"]) dev.stopDev(id);
  children.length = 0;
});

const last = () => children[children.length - 1]!;

describe("reachable", () => {
  it("is true when anything answers, without following redirects", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    expect(await dev.reachable("http://localhost:3000")).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000", expect.objectContaining({ redirect: "manual" }));
    expect(fetchMock.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("is false when the request fails", async () => {
    expect(await dev.reachable("http://localhost:3000")).toBe(false);
  });
});

describe("devStatus", () => {
  it("is stopped with no server and no url, and doesn't probe", async () => {
    expect(await dev.devStatus("a")).toEqual({ state: "stopped", command: undefined, reachable: false, log: "" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is running when the url answers even though Weft didn't start it", async () => {
    fetchMock.mockResolvedValue(new Response("ok"));
    expect(await dev.devStatus("a", "http://x")).toMatchObject({ state: "running", reachable: true });
  });

  it("is stopped when Weft didn't start it and the url doesn't answer", async () => {
    expect(await dev.devStatus("a", "http://x")).toMatchObject({ state: "stopped", reachable: false });
  });

  it("is starting while the server runs but doesn't answer yet, then running", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    expect(await dev.devStatus("a", "http://x")).toMatchObject({ state: "starting", command: "npm run dev" });
    fetchMock.mockResolvedValue(new Response("ok"));
    expect(await dev.devStatus("a", "http://x")).toMatchObject({ state: "running", reachable: true });
  });

  it("is failed after a non-zero exit and stopped after a clean one", async () => {
    await dev.startDev("a", "bad", "/app");
    last().emit("exit", 1);
    expect((await dev.devStatus("a")).state).toBe("failed");

    await dev.startDev("b", "ok", "/app");
    last().emit("exit", 0);
    expect((await dev.devStatus("b")).state).toBe("stopped");

    await dev.startDev("c", "signalled", "/app");
    last().emit("exit", null);
    expect((await dev.devStatus("c")).state).toBe("stopped");
  });

  it("is failed when the shell can't spawn, with the error in the log", async () => {
    await dev.startDev("a", "nope", "/app");
    last().emit("error", new Error("spawn ENOENT"));
    expect(await dev.devStatus("a")).toMatchObject({ state: "failed", log: "spawn ENOENT" });
  });

  it("shows the last 12 lines the server printed, from stdout and stderr", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    last().stdout.emit("data", Buffer.from(`${lines.slice(0, 10).join("\n")}\n`));
    last().stderr.emit("data", Buffer.from(`${lines.slice(10).join("\n")}\n`));
    expect((await dev.devStatus("a")).log).toBe(lines.slice(8).join("\n"));
  });

  it("keeps only the last 4000 characters of output", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    last().stdout.emit("data", Buffer.from("a".repeat(3000)));
    last().stdout.emit("data", Buffer.from("b".repeat(3000)));
    const { log } = await dev.devStatus("a");
    expect(log).toHaveLength(4000);
    expect(log).toBe("a".repeat(1000) + "b".repeat(3000));
  });
});

describe("startDev", () => {
  it("won't start a second Weft in Weft's own folder, whose dev script frees the board's port", async () => {
    await expect(dev.startDev("a", "pnpm dev", process.cwd())).rejects.toThrow(/would stop Weft itself/);
    // Any script that frees the port, not just `dev` (2026-10-23: `pnpm dev:web` killed the server).
    await expect(dev.startDev("a", "pnpm dev:web", process.cwd())).rejects.toThrow(/would stop Weft itself/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("gives an isolated card's server a PORT of its own and moves its url there", async () => {
    const started = await dev.startDev("iso", "pnpm dev", "/w", "T", "http://localhost:3000");
    const env = (spawn.mock.calls[0]![2] as { env: Record<string, string> }).env;
    expect(env.PORT).toBe(String(started.port));
    expect(started.url).toBe(`http://localhost:${started.port}/`);
    expect(await dev.startDev("iso", "pnpm dev", "/w")).toMatchObject({ port: started.port, url: started.url });
    dev.stopDev("iso");
    expect(await dev.startDev("a", "pnpm dev", "/repo", "T", "http://localhost:3000")).toEqual({ url: "http://localhost:3000", port: undefined });
  });

  it("spawns the command in the card's folder without a shell (L-4 narrowing)", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    // No shell: argv is split and the bin is the first token, not the whole command string.
    expect(spawn).toHaveBeenCalledWith("npm", ["run", "dev"], { cwd: "/app", env: { PATH: "/bin" }, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    expect(devSecrets).toHaveBeenCalledWith("a", "npm run dev", "/app", undefined);
  });

  it("refuses shell metacharacters instead of falling back to a shell", async () => {
    await dev.startDev("a", "npm run dev | tee log", "/app");
    // The error path spawns /bin/sh to write a one-line error to stderr; what we care about is
    // that the original command never reached a shell with its metacharacter intact. The
    // error message goes through shellEscape, which wraps it in single quotes — we check the
    // first word to avoid matching the quote-escaped form.
    expect(spawn.mock.calls[0]?.[0]).toBe("/bin/sh");
    expect((spawn.mock.calls[0]?.[1] as string[] | undefined)?.[1]).toMatch(/Won.* run dev command through a shell/);
  });

  it("starts through the secrets launcher when the vault has values, writing its request to stdin", async () => {
    const stdin = { end: vi.fn() };
    spawn.mockImplementationOnce(() => {
      const child = Object.assign(new FakeChild(++nextPid), { stdin });
      children.push(child);
      return child;
    });
    devSecrets.mockResolvedValueOnce({ launch: { bin: "/Electron", args: ["/app/secret-env.cjs"], env: { ELECTRON_RUN_AS_NODE: "1" }, stdin: '{"grant":"g"}', names: ["DATABASE_URL", "API_KEY"] } });
    await dev.startDev("a", "npm run dev", "/app");
    expect(spawn).toHaveBeenCalledWith("/Electron", ["/app/secret-env.cjs"], { cwd: "/app", env: { PATH: "/bin", ELECTRON_RUN_AS_NODE: "1" }, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    expect(stdin.end).toHaveBeenCalledWith('{"grant":"g"}');
    expect((await dev.devStatus("a")).log).toBe("With vault secrets: DATABASE_URL, API_KEY");
  });

  it("starts the plain way with the vault's note in the log", async () => {
    devSecrets.mockResolvedValueOnce({ note: "Started without vault secrets: not approved." });
    await dev.startDev("a", "npm run dev", "/app");
    expect((await dev.devStatus("a")).log).toBe("Started without vault secrets: not approved.");
  });

  it("leaves a running server with the same command alone", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    await dev.startDev("a", "npm run dev", "/app");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
  });

  it("replaces a server started with another command, killing its process group", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    const first = last();
    await dev.startDev("a", "pnpm dev", "/app");
    expect(kill).toHaveBeenCalledWith(-first.pid, "SIGTERM");
    expect(spawn).toHaveBeenCalledTimes(2);
    expect((await dev.devStatus("a")).command).toBe("pnpm dev");
  });

  it("restarts the same command once the old server has exited, without signalling it", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    last().emit("exit", 0);
    await dev.startDev("a", "npm run dev", "/app");
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(kill).not.toHaveBeenCalled();
  });

  it("doesn't mark the new server failed when the replaced one exits non-zero", async () => {
    await dev.startDev("a", "one", "/app");
    const first = last();
    await dev.startDev("a", "two", "/app");
    first.emit("exit", 143);
    expect((await dev.devStatus("a")).state).toBe("starting");
  });
});

describe("stopDev", () => {
  it("does nothing for a card with no server", () => {
    dev.stopDev("nobody");
    expect(kill).not.toHaveBeenCalled();
  });

  it("forgets the server and kills its process group", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    const child = last();
    dev.stopDev("a");
    expect(kill).toHaveBeenCalledWith(-child.pid, "SIGTERM");
    expect(child.kill).not.toHaveBeenCalled();
    expect(await dev.devStatus("a")).toMatchObject({ state: "stopped", command: undefined });
  });

  it("falls back to killing the shell when the group signal fails", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    kill.mockImplementationOnce(() => {
      throw new Error("ESRCH");
    });
    dev.stopDev("a");
    expect(last().kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("restartDev", () => {
  it("does nothing for a card with no server", async () => {
    await dev.restartDev("a");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("stops the server and starts it again the same way", async () => {
    await dev.startDev("a", "npm run dev", "/app", "A", "http://localhost:3000");
    const first = last();
    await dev.restartDev("a");
    expect(kill).toHaveBeenCalledWith(-first.pid, "SIGTERM");
    expect(spawn).toHaveBeenCalledTimes(2);
    // Same argv split, not the original string.
    expect(spawn.mock.calls[1]?.[0]).toBe("npm");
    expect(spawn.mock.calls[1]?.[1]).toEqual(["run", "dev"]);
    expect(spawn.mock.calls[1]?.[2]).toMatchObject({ cwd: "/app" });
    expect((await dev.devStatus("a")).command).toBe("npm run dev");
  });

  it("bumps the new run's restarts to 1, then 2, on each restart", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    expect(dev.runs.get("a")?.restarts).toBeUndefined();
    await dev.restartDev("a");
    expect(dev.runs.get("a")?.restarts).toBe(1);
    await dev.restartDev("a");
    expect(dev.runs.get("a")?.restarts).toBe(2);
  });
});

describe("on exit", () => {
  it("stops every server Weft started", async () => {
    expect(exitHooks).toHaveLength(1);
    await dev.startDev("a", "x", "/app");
    const a = last();
    await dev.startDev("b", "y", "/app");
    const b = last();
    exitHooks[0]!();
    expect(kill).toHaveBeenCalledWith(-a.pid, "SIGTERM");
    expect(kill).toHaveBeenCalledWith(-b.pid, "SIGTERM");
  });

  it("installs the hook only once per process, even when the module loads again", async () => {
    vi.resetModules();
    await import("./devserver");
    expect(exitHooks).toHaveLength(1);
  });
});

describe("startsWeft", () => {
  const weft = { pids: [], port: "1024", dir: "/w", names: [], lines: [] };
  it("names the board's address when it refuses", () => {
    expect(dev.startsWeft("pnpm dev", "/w", weft)).toContain("http://127.0.0.1:1024");
    expect(dev.startsWeft("pnpm dev", "/w", { ...weft, port: "" })).not.toContain("http://");
  });
  it("lets a project's own dev server start", () => {
    expect(dev.startsWeft("pnpm dev", "/shop", weft)).toBeNull();
  });
});

describe("splitCommand", () => {
  it("splits the launchers lib/dev-commands.ts produces", () => {
    expect(dev.splitCommand("npm run dev")).toEqual(["npm", "run", "dev"]);
    expect(dev.splitCommand("pnpm dev")).toEqual(["pnpm", "dev"]);
    expect(dev.splitCommand("yarn storybook dev --ci")).toEqual(["yarn", "storybook", "dev", "--ci"]);
    expect(dev.splitCommand("bin/rails server")).toEqual(["bin/rails", "server"]);
    expect(dev.splitCommand("bin/dev")).toEqual(["bin/dev"]);
    expect(dev.splitCommand("make dev")).toEqual(["make", "dev"]);
    expect(dev.splitCommand("deno task dev")).toEqual(["deno", "task", "dev"]);
    expect(dev.splitCommand("npx wrangler dev")).toEqual(["npx", "wrangler", "dev"]);
    expect(dev.splitCommand("python3 manage.py runserver")).toEqual(["python3", "manage.py", "runserver"]);
    expect(dev.splitCommand(".venv/bin/python manage.py runserver")).toEqual([".venv/bin/python", "manage.py", "runserver"]);
  });

  it("keeps quoted text as a single argv", () => {
    expect(dev.splitCommand(`node -e "console.log('hi')"`)).toEqual(["node", "-e", "console.log('hi')"]);
    expect(dev.splitCommand(`node -e 'console.log("hi")'`)).toEqual(["node", "-e", `console.log("hi")`]);
  });

  it("collapses tabs and runs of spaces", () => {
    expect(dev.splitCommand("pnpm   dev")).toEqual(["pnpm", "dev"]);
    expect(dev.splitCommand("pnpm\tdev")).toEqual(["pnpm", "dev"]);
  });

  it("returns an empty array for whitespace", () => {
    expect(dev.splitCommand("")).toEqual([]);
    expect(dev.splitCommand("   ")).toEqual([]);
  });
});
