// The pty a worker's line terminal runs (lib/host-line-terminal.ts): node-pty, as the desktop's terminal drawer uses
// (electron/terminal.cjs), loaded only when a terminal opens so a worker that never opens one never loads it.
import { createRequire } from "node:module";
import type { Pty } from "./host-line-terminal";

interface NodePty {
  spawn(file: string, args: string[], opts: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }): {
    onData(fn: (data: string) => void): unknown;
    onExit(fn: (e: { exitCode: number }) => void): unknown;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(): void;
  };
}

export const loginShell = (env: Record<string, string | undefined>, platform: string = process.platform) => env.SHELL || (platform === "win32" ? "powershell.exe" : "/bin/bash");

export function spawnPty(cwd: string, cols: number, rows: number, load: () => NodePty = () => createRequire(import.meta.url)("node-pty") as NodePty): Pty {
  const proc = load().spawn(loginShell(process.env), ["-l"], { name: "xterm-256color", cols, rows, cwd, env: { ...process.env, TERM: "xterm-256color" } });
  return {
    onData: (fn) => void proc.onData(fn),
    onExit: (fn) => void proc.onExit((e) => fn(e.exitCode)),
    write: (data) => proc.write(data),
    resize: (c, r) => proc.resize(c, r),
    kill: () => proc.kill(),
  };
}
