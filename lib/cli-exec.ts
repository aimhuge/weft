// Running the command-line tools Weft shells out to: find one on PATH, run it with a timeout, and hear what it
// said. One place for every CLI connector, so a new one is a list of commands rather than a new exec wrapper.
// The tools run as plain programs, no shell, so nothing a thread passes is parsed twice.

import { execFile, execFileSync } from "node:child_process";

/**
 * The path of a command on PATH, or null when it isn't there.
 *
 * env is the environment the lookup happens in: Weft's own PATH differs from a shell's (lib/env.ts's cliEnv
 * keeps the toolchain on it), so the caller says which PATH to look in.
 */
export function whichBin(name: string, { env = process.env }: { env?: NodeJS.ProcessEnv } = {}): string | null {
  try {
    return execFileSync("/usr/bin/which", [name], { encoding: "utf8", env }).trim() || null;
  } catch {
    return null;
  }
}

/** What to run, and how to run it. */
export type RunOptions = {
  // How long the tool may take before it is killed.
  timeout?: number;
  // The environment it runs in.
  env?: NodeJS.ProcessEnv;
  // "utf8" for text, "buffer" for bytes (a screenshot).
  encoding?: "utf8" | "buffer";
  // How much output it may produce before it is cut.
  maxBuffer?: number;
  // Written to the tool's stdin.
  input?: string;
  // What a failure says when the tool said nothing itself: the process's message, or the tool's name and
  // first argument in front of it. Null keeps the process's message alone.
  name?: string | null;
};

/**
 * Runs a command and resolves with its stdout. A failure rejects with an Error whose message is the tool's own
 * words: its stderr, then its stdout (some tools explain themselves on stdout), then whatever the tool is
 * called when it said nothing at all.
 */
export function runCli(bin: string, args: string[], { timeout, env, encoding = "utf8", maxBuffer, input, name = null }: RunOptions = {}): Promise<string | Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { timeout, env, encoding, maxBuffer } as Parameters<typeof execFile>[2], (err, stdout, stderr) => {
      if (!err) {
        resolve(stdout);
        return;
      }
      const said = `${String(stderr).trim()}\n${String(stdout).trim()}`.trim();
      const fallback = name === null ? err.message : `${name} ${args[0] ?? ""} failed: ${err.message}`;
      reject(new Error(said || fallback));
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

/** Runs a command and resolves with its stdout as text. */
export async function runCliText(bin: string, args: string[], opts: RunOptions = {}): Promise<string> {
  return String(await runCli(bin, args, { ...opts, encoding: "utf8" }));
}

/** Runs a command and resolves with its stdout as bytes (a screenshot is binary). */
export async function runCliBuffer(bin: string, args: string[], opts: RunOptions = {}): Promise<Buffer> {
  const out = await runCli(bin, args, { ...opts, encoding: "buffer" });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}
