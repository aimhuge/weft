import fs from "node:fs";
import path from "node:path";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { redactText, REDACTED } from "./share-redact";
import { readWorkerConfig, workerHome } from "./worker-config";
import { onWorker } from "./worker-pane";
import { keyStatus } from "./worker-secret-wiring";

// mcp__board__worker_log: who the box is and which Mac it trusts (what `weft-worker status` prints), then the end of a
// Weft Worker's own log, for a thread asking why the box is behind, why a clone failed or what the daemon said at start (docs/architecture/weft-worker.md#reading-the-log). The file stays sealed
// (lib/secret-guard-files.ts): it's the daemon's raw stdout and stderr, with nothing redacted on the way in. This reads it
// in the daemon's process and hides what a thread mustn't see first: the worker's own key, the Claude token and the
// GitHub token by value, then anything key-shaped or opaque (lib/share-redact.ts). Not a safe tool, so you approve it.

export const LOG_LINES = 80;
export const LOG_LINES_MAX = 300;
// Only the end of the file is read, so a log that grew for months costs the same as a fresh one.
const TAIL_BYTES = 256 * 1024;
const LINE_MAX = 400;

// The tokens this box holds, as values: a pattern can miss a shape, but never the exact string.
export function heldTokens(home: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const held = [readWorkerConfig(home)?.key, env.CLAUDE_CODE_OAUTH_TOKEN];
  try {
    // git's store helper: https://<user>:<token>@github.com, one a line.
    for (const line of fs.readFileSync(path.join(home, "github-credentials"), "utf8").split("\n")) {
      const token = /^https:\/\/[^:\s]*:([^@\s]+)@/.exec(line.trim())?.[1];
      if (token) held.push(decodeURIComponent(token));
    }
  } catch {
    // No GitHub sign-in by token on this box.
  }
  return held.filter((t): t is string => typeof t === "string" && t.length >= 8);
}

export function redactLine(line: string, held: string[]): string {
  const known = held.reduce((text, token) => text.split(token).join(REDACTED), line);
  const clean = redactText(known);
  return clean.length > LINE_MAX ? `${clean.slice(0, LINE_MAX)}…` : clean;
}

// The last `lines` lines of the file, each redacted. A first line cut by the byte window is dropped, since it's a part.
export function tailLog(file: string, lines: number, held: string[]): string {
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - TAIL_BYTES);
  const fd = fs.openSync(file, "r");
  let text: string;
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    text = buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
  const all = text.split("\n");
  if (start > 0) all.shift();
  if (all.at(-1) === "") all.pop();
  return all.slice(-lines).map((l) => redactLine(l, held)).join("\n");
}

export function workerLog(lines: number = LOG_LINES, home = workerHome(), env: NodeJS.ProcessEnv = process.env): string {
  if (!onWorker(env)) throw new Error("worker_log only works on a Weft Worker: this is the desktop app, whose own log isn't a file a thread reads.");
  const file = path.join(home, "worker.log");
  if (!fs.existsSync(file)) return `${status(home).join("\n")}\n\nThis worker has no worker.log yet: it wasn't started by its service (a daemon run by hand logs to its terminal).`;
  const n = Math.max(1, Math.min(LOG_LINES_MAX, Math.floor(lines)));
  return `${status(home).join("\n")}\n\nworker.log, last ${n} lines:\n${tailLog(file, n, heldTokens(home, env)) || "(empty)"}`;
}

// What `weft-worker status` prints, which a thread can't run (lib/worker-cli-guard.ts: the wrapper in ~/.local/bin is
// a thread's to edit, so no form of it is let through). Names and public-key fingerprints only.
function status(home: string): string[] {
  const config = readWorkerConfig(home);
  if (!config) return ["Not enrolled."];
  return [`Enrolled: ${config.name} (${config.device}), workspace ${config.orgId}`, ...keyStatus(home)];
}

export function workerLogTool() {
  return tool(
    "worker_log",
    `On a Weft Worker: the last lines of the worker's own log (default ${LOG_LINES}, at most ${LOG_LINES_MAX}), with its tokens and anything key-shaped hidden. Use it to find out why the worker is behind main, why a clone or sign-in failed, or what the daemon said at start. worker.log itself stays sealed, so don't try to read the file.`,
    { lines: z.number().int().min(1).max(LOG_LINES_MAX).optional() },
    ({ lines }) => {
      try {
        return Promise.resolve({ content: [{ type: "text" as const, text: workerLog(lines) }] });
      } catch (err) {
        return Promise.resolve({ content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true });
      }
    },
  );
}
