// A Weft thread that runs on the Goose CLI (github.com/aaif-goose/goose), the way a Codex thread runs
// on `codex exec`: a plain CLI whose stdout is a stream of events, parsed here and turned into the
// thread's rows (docs/architecture/goose.md).
//
// Three things shape this file:
//
// - Goose takes its working directory from the process it runs in, not from a flag, so the spawn's cwd
//   is the card's folder (lib/goose-recipe.ts's gooseArgs leaves it out on purpose).
// - Goose's `stream-json` output is JSON lines on stdout. stderr stays separate, because merging the
//   two corrupts the stream.
// - The provider key never reaches this process. Electron main holds it in the Keychain and hands the
//   subprocess an env through a one-time grant (lib/goose-launch.ts), so the runner starts Goose through
//   that helper rather than with the key itself.

import path from "node:path";
import readline from "node:readline";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { spawnCli } from "./cli-process";
import { cliEnv } from "./env";
import { gooseArgs, gooseRecipeYaml, GOOSE_RECIPE_CODE, type GooseTurnPlan } from "./goose-recipe";
import { gooseLaunch } from "./goose-launch";
import { openGooseMcp } from "./goose-mcp";
import { openGooseGuards } from "./guards/goose";
import { addToReply, flushReply, lastReply, resetReply } from "./goose-reply";
import { replacesSystemPrompt } from "./goose-provider";
import { progressPaths } from "./goose-progress-paths";
import { writeRecipe } from "./goose-recipe-store";
import { gooseHasSession, gooseStateRoot } from "./goose-state";
import { endsGooseTurn, parseGooseEvent, type GooseEvent, type GooseNotificationEvent } from "./goose-runner-events";
import { GOOSE_DEFAULT_MODEL } from "./new-thread";
import { handle } from "./runner-turn";
import { getCard, updateCard } from "./store";
import { touchFile } from "./overlap";
import type { Session } from "./runner-state";

// Goose's own knobs for a Weft thread.
export const GOOSE_ENV = {
  // No interactive prompts: the same as Weft's "auto" permission mode.
  GOOSE_MODE: "auto",
  // Goose must not reach for the macOS Keychain: Weft keeps the provider key itself.
  GOOSE_DISABLE_KEYRING: "1",
} as const;

// How much of Goose's stderr is kept for the error a failed turn shows.
const STDERR_TAIL = 4_000;
// How many plain-text lines of Goose's stdout a failed turn keeps, from its error on.
const PLAIN_LINES = 12;

function sdkMessage(message: unknown) {
  return message as SDKMessage;
}

/**
 * Where Goose keeps its own state (config, data, state): under Weft's data dir, one folder per card, so
 * two cards never share one Goose database. `--no-session` doesn't skip that: it still writes a hidden
 * session row.
 *
 * The root lives in lib/goose-state.ts, because the recipe store (lib/goose-recipe-store.ts) needs the
 * same folder and this module imports that store.
 */
export { gooseStateRoot } from "./goose-state";

/** The model the thread's rows are filed under. */
export function modelName(session: Session): string {
  const model = session.spec.model;
  return model && model !== GOOSE_DEFAULT_MODEL ? model : "Goose";
}

/** The assistant's text, as a row in the thread. */
async function assistant(session: Session, text: string) {
  await handle(session.cardId as string, session, sdkMessage({
    type: "assistant",
    parent_tool_use_id: null,
    message: {
      id: `goose-${Date.now()}`,
      type: "message",
      role: "assistant",
      model: modelName(session),
      content: [{ type: "text", text }],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }));
}

/**
 * A tool Goose ran, as the thread shows it. Goose's notifications carry what it is doing rather than a
 * tool's own name, so the row says so rather than pretending to be Claude's tool names.
 */
export function gooseToolUse(event: GooseEvent): { name: string; input: Record<string, unknown> } | null {
  if (event.kind !== "notification") return null;
  return { name: "Goose", input: { progress: event.progress } };
}

/** The tool's result, once it is known. */
export function gooseToolResult(progress: string, error?: string): { result: string; isError: boolean } {
  return { result: error ? error : progress, isError: Boolean(error) };
}

/** The turn's result: the text Goose finished with, or the error it failed with. */
async function result(session: Session, text: string, error?: string) {
  const id = session.cardId;
  if (!id) return;
  const model = modelName(session);
  const summary = error ?? (text || "Done.");
  await handle(id, session, sdkMessage({
    type: "result",
    subtype: error ? "error_execution" : "success",
    is_error: Boolean(error),
    result: summary,
    session_id: session.sessionId ?? session.spec.sessionId ?? "",
    total_cost_usd: 0,
    modelUsage: {
      [model]: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        costUSD: 0,
        contextWindow: 0,
        maxOutputTokens: 0,
      },
    },
  }));
}

/**
 * The files Goose touched, so the card's overlap warning knows about them.
 *
 * Only files inside the card's own folder are noted. A card works in its folder, so a path that
 * resolves outside it is not the card's to touch and not the card's to claim: the boundary is checked
 * on the resolved path, so a relative path with ".." in it that climbs out is dropped too.
 */
export function noteFileChanges(session: Session, paths: string[]) {
  const id = session.cardId;
  if (!id) return;
  const root = path.resolve(session.spec.cwd);
  for (const file of paths) {
    if (!file) continue;
    const absolute = path.resolve(root, file);
    if (!insideFolder(absolute, root)) continue;
    const card = getCard(id);
    const touched = touchFile(card?.touchedFiles, absolute);
    if (touched) updateCard(id, { touchedFiles: touched });
  }
}

/** Whether a path sits inside a folder: the folder itself, or somewhere under it. */
function insideFolder(child: string, parent: string): boolean {
  if (child === parent) return true;
  return child.startsWith(parent === "/" ? "/" : `${parent}/`);
}

/** Whether the event ends the turn. */
export function isTurnEnd(event: GooseEvent | null): boolean {
  return endsGooseTurn(event);
}

/** The text of an event that reaches the thread. */
export function eventText(event: GooseEvent): string {
  if (event.kind === "message") return event.text;
  if (event.kind === "error") return event.message;
  if (event.kind === "complete") return event.text;
  if (event.kind === "notification") return event.progress;
  return "";
}

/**
 * Applies one event to the thread. Returns true when the event ended the turn.
 */
export async function handleGooseEvent(session: Session, event: GooseEvent): Promise<boolean> {
  if (event.kind === "message") {
    if (event.text) await addToReply(session, event.text, event.id, (text) => assistant(session, text));
    return false;
  }
  // Anything else ends the reply being streamed, so it is filed before the event lands after it.
  await flushReply(session, (text) => assistant(session, text));
  // A progress note: what Goose is doing, not what it said. The thread shows it as a tool row.
  // The note also names the files Goose is working on, so the card's overlap warning sees them.
  const use = gooseToolUse(event);
  if (use) {
    const progress = (event as GooseNotificationEvent).progress;
    noteFileChanges(session, progressPaths(progress));
    const id = progress;
    if (!id || session.toolIndex.has(id)) return false;
    await handle(session.cardId as string, session, sdkMessage({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        id: `goose-${id}`,
        type: "message",
        role: "assistant",
        model: modelName(session),
        content: [{ type: "tool_use", id, ...use }],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }));
    return false;
  }
  if (event.kind === "error") {
    await result(session, "", event.message);
    return true;
  }
  if (event.kind === "complete") {
    // Goose 1.x ends with token counts and no text: the result is the last reply, as Claude Code's is.
    await result(session, event.text || lastReply(session));
    return true;
  }
  return false;
}

/**
 * Reads Goose's stdout as JSON lines and applies each one. A line that isn't a JSON object, or that
 * names a kind Weft doesn't act on, is skipped: Goose prints the odd line of noise on stdout.
 */
export async function readGooseEvents(session: Session, stdout: NodeJS.ReadableStream, plain: string[] = []): Promise<boolean> {
  let completed = false;
  resetReply(session);
  const lines = readline.createInterface({ input: stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const event = parseGooseEvent(line);
    if (!event) {
      keepPlainError(plain, line);
      continue;
    }
    if (await handleGooseEvent(session, event)) completed = true;
  }
  lines.close();
  // A stream that ends mid-reply still files what Goose said.
  await flushReply(session, (text) => assistant(session, text));
  return completed;
}

/**
 * Keeps the plain-text lines from Goose's stdout that start at an error. Goose prints a failure before a session
 * (no key, a bad provider) as text on stdout, not as an event, so it is the only word on why the turn died.
 */
function keepPlainError(plain: string[], line: string) {
  if (!plain.length && !/error/i.test(line)) return;
  plain.push(line.trim());
  if (plain.length > PLAIN_LINES) plain.shift();
}

/** The turn's prompt, as Goose takes it: the user's text, with a /name turned into the skill's own text. */
export function promptFor(session: Session, text: string): string {
  return text;
}

/** The plan a Goose turn runs under: the card's own settings, as the recipe module wants them. */
export function planFor(session: Session): GooseTurnPlan {
  return {
    cwd: session.spec.cwd,
    backend: "goose",
    copilot: session.spec.copilot,
    persona: session.spec.persona,
    agent: session.spec.agent,
    model: session.spec.model,
    permissionMode: session.spec.permissionMode,
    skillsOff: session.spec.skillsOff,
    provider: session.spec.provider,
    resume: Boolean(session.cardId) && gooseHasSession(session.cardId as string),
    instructionsInPrompt: replacesSystemPrompt(session.spec.gooseBaseUrl, session.spec.model),
  };
}

/**
 * The argv a Goose turn is started with. The provider and model come from the card's own plan, and the
 * working directory is the process's cwd, not an argument.
 */
export function argsFor(session: Session, text: string): string[] {
  return gooseArgs(planFor(session), text);
}

/**
 * The turn's recipe, written to disk under the card's own Goose state root.
 *
 * It is written before Goose is started, from the same plan and the same prompt the argv is built
 * from, so the file on disk is exactly what the run used. A write that fails is reported and dropped:
 * the turn runs either way, because a recipe nobody can re-run by hand is a nuisance, not a failure.
 */
export function saveTurnRecipe(session: Session, text: string): boolean {
  const id = session.cardId;
  if (!id) return false;
  try {
    return writeRecipe(id, gooseRecipeYaml(planFor(session), text));
  } catch (err) {
    // Rendering the recipe can throw too (a plan with something odd in it), and a recipe is worth less
    // than the turn it belongs to.
    console.error(`Couldn't render the Goose recipe for ${id}.`, err);
    return false;
  }
}

/** The env a Goose turn runs under, without the provider key (the launch helper adds that). */
export function gooseEnv(session: Session): Record<string, string> {
  const env = cliEnv();
  delete env.CLAUDE_CODE_ENTRYPOINT;
  // Goose's own state lives under this root, one per card, so two cards don't share one Goose database.
  const cardId = session.cardId;
  if (cardId) env.GOOSE_PATH_ROOT = gooseStateRoot(cardId);
  Object.assign(env, GOOSE_ENV);
  // The thread's provider and model, as Goose's own config vars, so a subagent the thread starts with a bare
  // `goose run --text` (lib/subagents.ts) runs on the same ones. --provider and --model still set this turn's.
  if (session.spec.provider) env.GOOSE_PROVIDER = session.spec.provider;
  if (session.spec.model) env.GOOSE_MODEL = session.spec.model;
  // The SDK's SpawnOptions types the env as strings only, and a var with no value is no value to a CLI.
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) clean[key] = value;
  }
  return clean;
}

/** The text of the message a turn starts with. */
export function messageText(message: { message?: { content?: unknown } }): string {
  const content = message.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object" || !("text" in part)) return "";
      // The text may be any shape. A part that isn't a string must not stringify to "[object Object]",
      // so only the primitives are stringified and anything else is dropped.
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") return text;
      if (typeof text === "number" || typeof text === "boolean") return String(text);
      return "";
    })
    .join("\n");
}

/**
 * Runs the session's turns on Goose: one process per turn, its stdout read as events.
 */
export async function driveGoose(session: Session, executable: string) {
  for await (const message of session.inbox) {
    if (session.abort.signal.aborted) break;
    await runGooseTurn(session, executable, messageText(message));
  }
}

/**
 * One turn on Goose: start the CLI, read its events, and fail the turn if it ends without a `complete`.
 */
async function runGooseTurn(session: Session, executable: string, prompt: string) {
  // Weft's guards, through Goose's own plugin hooks (lib/guards/goose.ts). Without them the turn doesn't start.
  const closeGuards = openGooseGuards(session);
  // Weft's own tools (mcp__browser__open_url and the rest) reach Goose for this turn only (lib/goose-mcp.ts).
  const closeMcp = openGooseMcp(session);
  try {
    await runGooseProcess(session, executable, prompt);
  } finally {
    closeMcp();
    closeGuards();
  }
}

/** Starts the turn's `goose run`, reads its events, and fails the turn if it ends without a `complete`. */
async function runGooseProcess(session: Session, executable: string, prompt: string) {
  // The recipe is written before Goose is started, from the same plan and prompt the argv is built
  // from, so the file on disk is exactly what the run used. A write that fails doesn't stop the turn.
  saveTurnRecipe(session, prompt);
  const argv = argsFor(session, prompt);
  const env = gooseEnv(session);
  const stderr = (data: string) => console.error(`[thread ${(session.cardId ?? "spare").slice(0, 8)}] ${data.trimEnd()}`);
  session.toolIndex.clear();
  // The provider's key stays in Electron main: the launch helper starts Goose with it in its env, so
  // this process never holds the plaintext. Without a saved key the plain binary is started, which is
  // what Goose wants when the user configured a provider itself.
  // The helper spawns argv[0] as the program, so the Goose binary leads; without it the helper tried to run `run`.
  const launch = session.spec.provider ? await gooseLaunch(session.spec.provider, [executable, ...argv], env, session.spec.cwd, session.spec.gooseBaseUrl ?? "") : undefined;
  const command = launch ? launch.bin : executable;
  const args = launch ? launch.args : argv;
  const childEnv: Record<string, string> = launch ? { ...env, ...launch.env } : env;
  const proc = spawnCli({ command, args, cwd: session.spec.cwd, env: childEnv, signal: session.abort.signal }, stderr);
  session.process = proc;
  proc.stdin.on("error", () => {});
  // The prompt goes on the command line (--text), so the helper's stdin carries the grant instead.
  proc.stdin.end(launch ? launch.stdin : "");
  let spawnError: Error | undefined;
  proc.once("error", (error) => {
    spawnError = error;
  });
  const exited = new Promise<void>((resolve) => {
    // The SDK's SpawnedProcess types no `close` event, so the listener is reached through the
    // process's own emitter: the event fires with the code and the signal that ended the process.
    (proc as unknown as { once(event: "close", listener: () => void): void }).once("close", () => resolve());
  });
  const plain: string[] = [];
  const completed = await readGooseEvents(session, proc.stdout, plain);
  await exited;
  if (spawnError) throw spawnError;
  if (completed || session.abort.signal.aborted) return;
  // The turn ended without a `complete` event: Goose failed, and its stderr says why.
  const tail = (proc.stderrTail() || plain.join("\n")).slice(-STDERR_TAIL);
  const signal = proc.signalCode;
  throw new Error(tail || `Goose exited ${signal ? `on ${signal}` : `with code ${proc.exitCode ?? "unknown"}`} without finishing the turn.`);
}

// The code in this module, fed into the runner's BUILD fingerprint (lib/runner-session.ts) so a change to
// the runner or to the plan it starts Goose with replaces idle sessions.
export const GOOSE_RUNNER_CODE = [
  driveGoose, assistant, result, noteFileChanges, handleGooseEvent, readGooseEvents, promptFor, argsFor, gooseEnv,
  gooseToolUse, gooseToolResult, isTurnEnd, eventText, messageText, modelName, planFor, saveTurnRecipe,
  openGooseMcp, openGooseGuards, addToReply, flushReply, lastReply, resetReply, replacesSystemPrompt, parseGooseEvent,
  ...GOOSE_RECIPE_CODE,
];
