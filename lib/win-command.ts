// Running commands on Windows, where three POSIX habits break (docs/architecture/windows.md):
// - there is no /usr/bin/which: a command is found by walking PATH with each PATHEXT extension;
// - an npm-installed CLI is a `.cmd` shim, which Node refuses to spawn without a shell, and cmd.exe parses its
//   command line again, so each argument is quoted for CommandLineToArgvW and its cmd metacharacters escaped
//   (the way cross-spawn does it);
// - a process group can't be signalled (process.kill(-pgid) throws): taskkill /T ends a process tree.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// An environment to read: the process's own, a CLI's, or a test's plain object.
type Env = Record<string, string | undefined>;

export const isWindows = (platform: string = process.platform) => platform === "win32";

// PATH under whatever casing Windows gave it ("Path" is common), from a plain env object.
function envValue(env: Env, name: string) {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key ? env[key] : undefined;
}

function isFile(file: string) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The full path of a command on a Windows PATH, trying each PATHEXT extension; null when it isn't there. */
export function findOnWindowsPath(name: string, { env = process.env, exists = isFile }: { env?: Env; exists?: (file: string) => boolean } = {}): string | null {
  const dirs = (envValue(env, "PATH") || "").split(";").filter(Boolean);
  const pathext = (envValue(env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const exts = path.win32.extname(name) ? [""] : pathext.map((ext) => ext.toLowerCase());
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.win32.join(dir.replace(/^"|"$/g, ""), name + ext);
      if (exists(full)) return full;
    }
  }
  return null;
}

const META = /([()\][%!^"`<>&|;, *?])/g;

// One argument, quoted for CommandLineToArgvW and then escaped for cmd.exe.
export function quoteCmdArg(arg: string) {
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  return quoted.replace(META, "^$1");
}

export type SpawnPlan = { command: string; args: string[]; windowsVerbatimArguments?: boolean };

/** How to spawn command with args: as it is, unless it's a Windows .cmd/.bat shim, which goes through cmd.exe. */
export function spawnPlan(command: string, args: string[], { platform = process.platform, env = process.env }: { platform?: string; env?: Env } = {}): SpawnPlan {
  if (!isWindows(platform) || !/\.(cmd|bat)$/i.test(command)) return { command, args };
  const line = [command.replace(META, "^$1"), ...args.map(quoteCmdArg)].join(" ");
  return { command: envValue(env, "COMSPEC") || "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], windowsVerbatimArguments: true };
}

/** A shell command line's shell: $SHELL (or zsh) -c on a Mac, cmd.exe /d /s /c on Windows. */
export function shellPlan(line: string, { platform = process.platform, env = process.env }: { platform?: string; env?: Env } = {}): SpawnPlan {
  if (!isWindows(platform)) return { command: env.SHELL || "/bin/zsh", args: ["-c", line] };
  return { command: envValue(env, "COMSPEC") || "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], windowsVerbatimArguments: true };
}

/** Ends a Windows process and everything it started; false when there was nothing left to end. */
export function killTree(pid: number, run: typeof execFileSync = execFileSync) {
  try {
    run("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}
