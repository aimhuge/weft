import readline from "node:readline";
import { stderrLogger } from "./cli-messages";
import { spawnCli } from "./cli-process";
import type { Session } from "./runner-state";

// One turn of a CLI that runs one process per turn (Codex, Goose; docs/architecture/cli-adapters.md): start it in the
// card's folder, hand it its input on stdin, read its stdout line by line, and fail the turn when the process ends
// without the line that finishes it. What the lines mean is the adapter's; how the process runs is shared here.

export type CliExit = { code: number | null; signal: NodeJS.Signals | null };

export interface CliTurn {
  /** The CLI's name, for the error a turn that never finished shows. */
  name: string;
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
  /** What the CLI reads on stdin; stdin is closed after it. */
  stdin: string;
  /** Reads the CLI's stdout; true when the turn finished. */
  read(stdout: NodeJS.ReadableStream): Promise<boolean>;
  /** The words a turn that never finished fails with, from the CLI's stderr tail; the tail itself by default. */
  explain?(stderrTail: string): Promise<string> | string;
}

// The SDK's SpawnedProcess types only exit and error; a child's "close" (stdout drained too) comes with its code and signal.
interface ClosingProcess {
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  once(event: "error", listener: (error: Error) => void): void;
}

/** Reads a stream line by line, skipping blank ones. True when any line's handler said the turn finished. */
export async function readLines(stream: NodeJS.ReadableStream, onLine: (line: string) => Promise<boolean> | boolean): Promise<boolean> {
  let finished = false;
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    if (await onLine(line)) finished = true;
  }
  lines.close();
  return finished;
}

/** A JSON-lines event: the line's object, or undefined for noise (not JSON, or JSON that isn't an object). */
export function parseJsonLine(line: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Reads a stream of JSON lines, handing each object to onEvent and skipping blank and non-JSON lines. */
export function readJsonLines(stream: NodeJS.ReadableStream, onEvent: (event: Record<string, unknown>) => Promise<boolean> | boolean): Promise<boolean> {
  return readLines(stream, (line) => {
    const event = parseJsonLine(line);
    return event ? onEvent(event) : false;
  });
}

/** The error a turn that ended without finishing fails with: what the CLI said, or how it exited. */
export function unfinishedTurn(name: string, exit: CliExit, said: string): Error {
  return new Error(said || `${name} exited ${exit.signal ? `on ${exit.signal}` : `with code ${exit.code ?? "unknown"}`} without finishing the turn.`);
}

/** Runs one turn's process to its end. Throws its spawn error, or the unfinished-turn error unless the session was aborted. */
export async function runCliTurn(session: Session, turn: CliTurn): Promise<void> {
  const proc = spawnCli({ command: turn.command, args: turn.args, cwd: session.spec.cwd, env: turn.env, signal: session.abort.signal }, stderrLogger(session));
  session.process = proc;
  proc.stdin.on("error", () => {});
  proc.stdin.end(turn.stdin);
  const events = proc as unknown as ClosingProcess;
  let spawnError: Error | undefined;
  events.once("error", (error) => {
    spawnError = error;
  });
  const exited = new Promise<CliExit>((resolve) => events.once("close", (code, signal) => resolve({ code, signal })));
  const finished = await turn.read(proc.stdout);
  const exit = await exited;
  if (spawnError) throw spawnError;
  if (finished || session.abort.signal.aborted) return;
  const tail = proc.stderrTail();
  throw unfinishedTurn(turn.name, exit, turn.explain ? await turn.explain(tail) : tail);
}

export const CLI_TURN_CODE = [readLines, parseJsonLine, readJsonLines, unfinishedTurn, runCliTurn];
