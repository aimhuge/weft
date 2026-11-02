import { afterEach, describe, expect, it, vi } from "vitest";
import { KILL_GRACE_MS, endGroup, groups, killAllGroups, killGroup, spawnCli, withStderr } from "./cli-process";
import { cardForCap, pidForCap, setConnectorSetup, withConnectorEnv } from "./connector-env";

// Real processes: a shell (the wrapper) that starts `sleep` (its child) and prints the child's pid.

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(check: () => boolean, ms = KILL_GRACE_MS + 2_000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  return check();
}

function start(script: string, signal = new AbortController().signal, onStderr?: (t: string) => void) {
  const proc = spawnCli({ command: "/bin/sh", args: ["-c", script], env: process.env, signal }, onStderr);
  const child = new Promise<number>((resolve) => {
    let out = "";
    proc.stdout.on("data", (d: Buffer) => {
      out += d.toString();
      if (out.includes("\n")) resolve(Number(out.trim()));
    });
  });
  return { proc, child };
}

const strays: number[] = [];
afterEach(() => {
  for (const pid of strays.splice(0)) if (alive(pid)) process.kill(pid, "SIGKILL");
});

describe("spawnCli", () => {
  it("ends the child a wrapper leaves behind when it exits on its own", async () => {
    const { proc, child } = start("sleep 60 & echo $!; exit 0");
    const pid = await child;
    strays.push(pid);
    expect(groups.size).toBeGreaterThan(0);
    await new Promise((r) => proc.once("exit", r));
    expect(proc.exitCode).toBe(0);
    expect(await until(() => !alive(pid))).toBe(true);
  });

  it("kill() signals the whole group, not just the wrapper", async () => {
    const { proc, child } = start("sleep 60 & echo $!; wait");
    const pid = await child;
    strays.push(pid);
    const exited = new Promise((r) => proc.on("exit", r));
    expect(proc.kill("SIGTERM")).toBe(true);
    await exited;
    expect(proc.killed).toBe(false);
    expect(proc.signalCode).toBe("SIGTERM");
    expect(await until(() => !alive(pid))).toBe(true);
  });

  it("ends the group when the SDK aborts, with SIGKILL for a child that ignores SIGTERM", async () => {
    const abort = new AbortController();
    const { child } = start("trap '' TERM; sleep 60 & echo $!; wait", abort.signal);
    const pid = await child;
    strays.push(pid);
    abort.abort();
    await new Promise((r) => setTimeout(r, 300));
    expect(alive(pid)).toBe(true);
    expect(await until(() => !alive(pid))).toBe(true);
  });

  it("ends a child in a process group of its own, as the CLI's Bash commands run, with SIGKILL if it ignores SIGTERM", async () => {
    const abort = new AbortController();
    // `set -m` gives each background job its own group, like Claude Code's Bash tool.
    const { child } = start("set -m; (trap '' TERM; exec sleep 60) & echo $!; wait", abort.signal);
    const pid = await child;
    strays.push(pid);
    abort.abort();
    await new Promise((r) => setTimeout(r, 300));
    expect(alive(pid)).toBe(true);
    expect(await until(() => !alive(pid))).toBe(true);
  });

  it("ends the group at once when the signal is already aborted", async () => {
    const abort = new AbortController();
    abort.abort();
    const { proc } = start("sleep 60", abort.signal);
    await new Promise((r) => proc.once("exit", r));
    expect(proc.signalCode).toBe("SIGTERM");
  });

  it("keeps the stderr tail and passes stderr on", async () => {
    const onStderr = vi.fn();
    const { proc } = start("echo not logged in >&2; exit 1", undefined, onStderr);
    const off = vi.fn();
    proc.on("exit", off);
    proc.off("exit", off);
    await new Promise((r) => proc.once("exit", r));
    await until(() => proc.stderrTail() !== "", 1_000);
    expect(proc.stderrTail()).toBe("not logged in");
    expect(onStderr).toHaveBeenCalledWith("not logged in\n");
    expect(off).not.toHaveBeenCalled();
  });

  it("binds a worker session's connector capability to the CLI's pid, and drops it when the CLI exits", async () => {
    setConnectorSetup({ socket: "/s", node: "/n", helper: "/h", binDir: "/b", boxHelpers: [] });
    const env = withConnectorEnv({ PATH: "/usr/bin:/bin" }, () => "c1");
    const proc = spawnCli({ command: "/bin/sh", args: ["-c", "sleep 0.2"], env, signal: new AbortController().signal });
    expect(pidForCap(env.WEFT_CONNECTOR_CAP)).toBe(proc.pid);
    await new Promise((r) => proc.once("exit", r));
    expect(cardForCap(env.WEFT_CONNECTOR_CAP)).toBeUndefined();
    setConnectorSetup(null);
  });

  it("reports a command that can't start through 'error', and kill falls back to the child", async () => {
    const proc = spawnCli({ command: "/nonexistent/cli", args: [], env: process.env, signal: new AbortController().signal });
    const err = await new Promise<Error>((r) => proc.once("error", r));
    expect(err.message).toMatch(/ENOENT/);
    expect(proc.kill("SIGTERM")).toBe(false);
  });
});

describe("groups", () => {
  it("killGroup forgets a group with nothing left in it", () => {
    groups.add(999_999);
    expect(killGroup(999_999, "SIGTERM")).toBe(false);
    expect(groups.has(999_999)).toBe(false);
  });

  it("endGroup does nothing for a gone group", () => {
    endGroup(999_998);
    expect(groups.has(999_998)).toBe(false);
  });

  it("killAllGroups SIGKILLs every CLI and the groups it started, and runs as the server exits", async () => {
    const { child } = start("set -m; (trap '' TERM; exec sleep 60) & echo $!; wait");
    const pid = await child;
    strays.push(pid);
    expect(process.listeners("exit")).toContain(killAllGroups);
    killAllGroups();
    expect(groups.size).toBe(0);
    expect(await until(() => !alive(pid), 1_000)).toBe(true);
  });
});

describe("withStderr", () => {
  it("adds the tail once", () => {
    expect(withStderr("exited with code 1", "")).toBe("exited with code 1");
    expect(withStderr("exited with code 1", undefined)).toBe("exited with code 1");
    expect(withStderr("exited with code 1", "Please run /login")).toBe("exited with code 1\nPlease run /login");
    expect(withStderr("exited: Please run /login", "Please run /login")).toBe("exited: Please run /login");
  });
});
