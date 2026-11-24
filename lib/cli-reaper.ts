import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

// Once per server start: end the thread CLIs an earlier Weft server left running. A server killed
// outright (SIGKILL, a crash) never runs lib/cli-process.ts's exit hook, so its CLIs reparent to PID 1.
// Only orphans (parent PID 1) whose folder is one of Weft's projects go: puku you run in a terminal
// has the shell as its parent, so it's never touched.

const run = promisify(execFile);

export interface Proc {
  pid: number;
  ppid: number;
  command: string;
}

// `ps -axo pid=,ppid=,command=` → one row per process.
export function parsePs(out: string): Proc[] {
  return out
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map(([, pid, ppid, command = ""]) => ({ pid: Number(pid), ppid: Number(ppid), command }));
}

// A thread CLI: puku-cli's wrapper or its `Puku` child, the Agent SDK's Claude Code binary from Weft's own
// node_modules, or the Codex a card drives. Codex is matched on its `exec` subcommand, which only Weft's
// runner passes (lib/codex-runner-prompt.ts argsFor: `exec --json` or `exec resume --json`), so a codex you
// run by hand, and the long-lived `codex app-server` daemon (which spawns its own process tree under PID 1
// after a crash), are never touched. Antigravity is matched the same way, on the `acp` subcommand Weft's runner
// starts it with (`agy acp`), so an interactive `agy` in a terminal is never touched.
export function isThreadCli(command: string, sdkDir: string) {
  const [exe = ""] = command.split(/\s+/);
  const base = path.basename(exe);
  return (
    base === "Puku" ||
    /(^|\/)puku-cli(\s|$)/.test(command) ||
    exe.startsWith(sdkDir) ||
    (base === "codex" && /(?:^|\s)exec(?:\s|$)/.test(command)) ||
    (base === "agy" && /(?:^|\s)acp(?:\s|$)/.test(command))
  );
}

// `lsof -Fpn -d cwd` → pid → cwd.
export function parseLsof(out: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid = 0;
  for (const line of out.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

export function inFolder(cwd: string, folders: string[]) {
  return folders.some((f) => cwd === f || cwd.startsWith(f.endsWith("/") ? f : `${f}/`));
}

// SIGKILLs the pids whose working folder is one of Weft's projects and returns them.
export async function killInFolders(pids: number[], folders: string[]) {
  // lsof exits 1 when some pid has gone in the meantime; what it printed still holds.
  const lsof = await run("/usr/sbin/lsof", ["-a", "-d", "cwd", "-Fpn", "-p", pids.join(",")]).catch(
    (err: unknown) => ({ stdout: (err as { stdout?: string }).stdout ?? "" }),
  );
  const cwds = parseLsof(lsof.stdout);
  const strays = pids.filter((pid) => inFolder(cwds.get(pid) ?? "", folders));
  for (const pid of strays) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  return strays;
}

// Kills the strays and returns their pids.
export async function reapStrayClis(folders: string[], sdkDir = path.join(process.cwd(), "node_modules", "@anthropic-ai")) {
  if (process.platform === "win32" || folders.length === 0) return [];
  const { stdout } = await run("/bin/ps", ["-axo", "pid=,ppid=,command="]);
  const orphans = parsePs(stdout).filter((p) => p.ppid === 1 && isThreadCli(p.command, sdkDir));
  if (orphans.length === 0) return [];
  const strays = await killInFolders(orphans.map((p) => p.pid), folders);
  if (strays.length) console.log(`[weft] ended ${strays.length} thread CLI(s) an earlier server left running: ${strays.join(", ")}`);
  return strays;
}
