import { spawn } from "node:child_process";
import fs from "node:fs";
import { cliEnv } from "./env";
import { findSecret } from "./secret-detect";
import { bashVerdict } from "./secret-guard";
import { appendThread, getCard, getThread, replaceThreadItem } from "./store";
import type { ThreadItem } from "./types";
import { workDir } from "./work-dir";

// "!" in a thread's reply box: your own shell command, run in the card's folder like Claude Code's bash
// mode. It shows in the thread as it runs, and what it printed goes to Claude with your next message.

export type ShellItem = Extract<ThreadItem, { kind: "shell" }>;

// A "!" command is for a quick look (git status, ls, a test file), not a server: it's killed after this.
export const SHELL_TIMEOUT_MS = 2 * 60_000;
// What the thread keeps of a command's output, and so what Claude reads: its end, where errors land.
export const OUTPUT_LIMIT = 20_000;

// Colors and cursor moves mean nothing in the thread or to Claude.
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

// Keys the command printed (an env dump, a config file) come out as ‹what it was›, since Claude reads this.
export function redactSecrets(text: string): string {
  let out = text;
  for (let i = 0; i < 100; i++) {
    const hit = findSecret(out);
    if (!hit) break;
    out = out.split(hit.value).join(`‹${hit.kind}›`);
  }
  return out;
}

export function cleanOutput(raw: string): string {
  const text = redactSecrets(raw.replace(ANSI, "").replace(/\r\n?/g, "\n")).replace(/\s+$/, "");
  return text.length > OUTPUT_LIMIT ? `… (${text.length - OUTPUT_LIMIT} characters cut)\n${text.slice(-OUTPUT_LIMIT)}` : text;
}

// Starts the command and adds it to the thread; the item fills in with the output once it ends.
// Throws, with nothing added, when the command can't run here.
export function runShell(cardId: string, command: string): number {
  const card = getCard(cardId);
  if (!card) throw new Error("No such card.");
  if (!command) throw new Error("Write a command after the !.");
  const cwd = workDir(card);
  if (!fs.existsSync(cwd)) throw new Error(`This thread's folder ${cwd} doesn't exist anymore.`);
  // Its output goes to Claude, so the reads the thread's own Bash can't make (.env, an env dump) stay out too.
  const refused = bashVerdict(command);
  if (refused) throw new Error(`Not run, since its output goes to Claude: ${refused} Use the terminal (⌃\`) for that.`);

  const at = Date.now();
  const index = appendThread(cardId, { kind: "shell", command, at });
  let raw = "";
  let timedOut = false;
  let ended = false;

  // Its own process group, so the timeout stops what it started too (a pipeline, a dev server).
  const proc = spawn(process.env.SHELL || "/bin/zsh", ["-c", command], {
    cwd,
    env: { ...cliEnv(), TERM: "dumb", NO_COLOR: "1", GIT_PAGER: "cat", PAGER: "cat" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      if (proc.pid) process.kill(-proc.pid, "SIGKILL");
    } catch {
      proc.kill("SIGKILL");
    }
  }, SHELL_TIMEOUT_MS);
  const finish = (exitCode: number | null, extra = "") => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    const output = cleanOutput(raw + extra);
    replaceThreadItem(cardId, index, { kind: "shell", command, at, output, exitCode, ms: Date.now() - at, ...(timedOut && { timedOut }) });
  };
  const collect = (chunk: Buffer) => {
    // Twice what's kept, so the cut lands after the ANSI codes come out.
    raw = (raw + chunk.toString("utf8")).slice(-OUTPUT_LIMIT * 2);
  };
  proc.stdout.on("data", collect);
  proc.stderr.on("data", collect);
  proc.on("error", (err) => finish(null, err.message));
  proc.on("close", (code) => finish(code));
  return index;
}

// The "!" commands since your last message, as Claude Code hands them to Claude, marked sent so each
// goes once. Commands still running wait for the message after.
export function takeShellContext(cardId: string): string {
  // A stored thread can hold a null hole.
  const items: (ThreadItem | null)[] = getThread(cardId);
  const blocks: string[] = [];
  items.forEach((item, index) => {
    if (item?.kind !== "shell" || item.sent || item.ms === undefined) return;
    replaceThreadItem(cardId, index, { ...item, sent: true });
    blocks.push(shellBlock(item));
  });
  return blocks.join("\n");
}

export function shellBlock(item: ShellItem): string {
  const status = item.timedOut
    ? `\n(stopped after ${SHELL_TIMEOUT_MS / 60_000} minutes)`
    : item.exitCode
      ? `\n(exit code ${item.exitCode})`
      : "";
  return `<bash-input>${item.command}</bash-input>\n<bash-stdout>${item.output ?? ""}${status}</bash-stdout>`;
}

// What a sent message's CLI text becomes: the shell context first, then the message. A slash command
// has to start the text, so it goes without and the context waits for the next message.
export function withShellContext(cardId: string, text: string): string {
  if (text.trimStart().startsWith("/")) return text;
  const context = takeShellContext(cardId);
  return context ? `${context}\n\n${text}` : text;
}
