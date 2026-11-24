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

import { CLI_ADAPTER_CODE, driveAdapter, messageText, type CliAdapter } from "./cli-adapter";
import { CLI_MESSAGES_CODE, fileReply, fileResult, fileToolStart, noteTouched, scrub } from "./cli-messages";
import { CLI_TURN_CODE, readLines, runCliTurn } from "./cli-turn";
import { cliEnv } from "./env";
import { gooseArgs, gooseRecipeYaml, GOOSE_RECIPE_CODE, type GooseTurnPlan } from "./goose-recipe";
import { gooseLaunch } from "./goose-launch";
import { openGooseMcp } from "./goose-mcp";
import { openGooseGuards } from "./guards/goose";
import { addToReply, flushReply, lastReply, resetReply } from "./goose-reply";
import { gooseEndpointEnv, replacesSystemPrompt } from "./goose-provider";
import { progressPaths } from "./goose-progress-paths";
import { writeRecipe } from "./goose-recipe-store";
import { gooseHasSession, gooseStateRoot } from "./goose-state";
import { endsGooseTurn, parseGooseEvent, type GooseEvent, type GooseNotificationEvent } from "./goose-runner-events";
import { GOOSE_DEFAULT_MODEL } from "./new-thread";
import type { Session } from "./runner-state";

// The text of the message a turn starts with, shared by every CLI adapter (lib/cli-adapter.ts); kept here for callers.
export { messageText };

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

/**
 * The assistant's text, as a row in the thread. Like every row Goose files it goes through lib/cli-messages.ts's scrub
 * first: any vault value or provider key the card used becomes ‹NAME›, and on a worker the Goose key the Mac sealed
 * for this turn is one (lib/worker-goose-key.ts).
 */
async function assistant(session: Session, raw: string) {
  await fileReply(session, raw, modelName(session), "goose");
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
  await fileResult(session, modelName(session), { text, error });
}

/**
 * The files Goose touched, so the card's overlap warning knows about them: only the ones inside the card's own
 * folder, checked on the resolved path (lib/cli-messages.ts's noteTouched).
 */
export const noteFileChanges = noteTouched;

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
    const progress = await scrub(session, (event as GooseNotificationEvent).progress);
    noteFileChanges(session, progressPaths(progress));
    // The note is the row's id too: the same note twice draws one row.
    await fileToolStart(session, progress, { ...use, input: { progress } }, modelName(session), "goose");
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
  resetReply(session);
  const completed = await readLines(stdout, (line) => {
    const event = parseGooseEvent(line);
    if (event) return handleGooseEvent(session, event);
    keepPlainError(plain, line);
    return false;
  });
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

/** The adapter a Goose thread runs on: one `goose run` per turn (lib/cli-adapter.ts). */
export function gooseAdapter(executable: string): CliAdapter {
  return { name: "Goose", runTurn: (session, message) => runGooseTurn(session, executable, messageText(message)) };
}

/**
 * Runs the session's turns on Goose: one process per turn, its stdout read as events.
 */
export function driveGoose(session: Session, executable: string) {
  return driveAdapter(session, gooseAdapter(executable));
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

// The launch helper's env over the turn's; with no grant (a worker, or Goose holding its own key) the endpoint the
// settings name still applies.
function childEnvOf(session: Session, env: Record<string, string>, granted: Record<string, string> | undefined): Record<string, string> {
  if (granted) return { ...env, ...granted };
  return { ...env, ...gooseEndpointEnv(session.spec.provider ?? "", session.spec.gooseBaseUrl ?? "") };
}

/** Starts the turn's `goose run`, reads its events, and fails the turn if it ends without a `complete`. */
async function runGooseProcess(session: Session, executable: string, prompt: string) {
  // The recipe is written before Goose is started, from the same plan and prompt the argv is built
  // from, so the file on disk is exactly what the run used. A write that fails doesn't stop the turn.
  saveTurnRecipe(session, prompt);
  const argv = argsFor(session, prompt);
  const env = gooseEnv(session);
  // The provider's key stays in Electron main: the launch helper starts Goose with it in its env, so
  // this process never holds the plaintext. Without a saved key the plain binary is started, which is
  // what Goose wants when the user configured a provider itself. On a worker the key comes sealed from
  // the paired Mac after Touch ID and goes into this one process's env (lib/worker-goose-key.ts).
  // The helper spawns argv[0] as the program, so the Goose binary leads; without it the helper tried to run `run`.
  const launch = session.spec.provider ? await gooseLaunch(session.spec.provider, [executable, ...argv], env, session.spec.cwd, session.spec.gooseBaseUrl ?? "", session.cardId) : undefined;
  const plain: string[] = [];
  await runCliTurn(session, {
    name: "Goose",
    command: launch ? launch.bin : executable,
    args: launch ? launch.args : argv,
    env: childEnvOf(session, env, launch?.env),
    // The prompt goes on the command line (--text), so the helper's stdin carries the grant instead.
    stdin: launch ? launch.stdin : "",
    read: (stdout) => readGooseEvents(session, stdout, plain),
    // A turn that ended without a `complete`: Goose failed, and its stderr (or the error it printed on stdout) says why.
    explain: (stderrTail) => scrub(session, (stderrTail || plain.join("\n")).slice(-STDERR_TAIL)),
  });
}

// The code in this module, fed into the runner's BUILD fingerprint (lib/runner-session.ts) so a change to
// the runner or to the plan it starts Goose with replaces idle sessions.
export const GOOSE_RUNNER_CODE = [
  driveGoose, gooseAdapter, runGooseTurn, runGooseProcess, childEnvOf, assistant, result, handleGooseEvent, readGooseEvents,
  keepPlainError, promptFor, argsFor, gooseEnv, gooseToolUse, gooseToolResult, isTurnEnd, eventText, modelName, planFor,
  saveTurnRecipe, openGooseMcp, openGooseGuards, addToReply, flushReply, lastReply, resetReply, replacesSystemPrompt,
  parseGooseEvent, ...GOOSE_RECIPE_CODE, ...CLI_ADAPTER_CODE, ...CLI_MESSAGES_CODE, ...CLI_TURN_CODE,
];
