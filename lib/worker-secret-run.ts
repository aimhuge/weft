// mcp__secrets__run on a Weft Worker (docs/architecture/project-hosts.md#secrets-on-a-worker-h8-the-per-use-seal-as-built).
// The vault is on the owner's Mac, so the tool opens an ask (lib/worker-secret-asks.ts), sends it to the Mac as a
// `secret_run` device call, and waits: the Mac answers denied, missing names, or queued, and a queued one arrives as a
// sealed `secret_use` the daemon delivers here. The command then runs on this box the way main runs one
// (electron/secret-exec.cjs): no shell, the values in the child's env only, the output redacted. The values stay in
// this process's memory for redactStored, as main keeps a card's, and never touch the disk.
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { cliEnv } from "./env";
import { globalSingleton } from "./global-singleton";
import { hasUnsafeText, packageScript } from "./secret-command";
import { ASK_MS, askMessage, newNonce, type SecretAsk } from "./secret-use";
import type { BoardEvent } from "./types";
import { openAsk, type OpenAsk } from "./worker-secret-asks";
import type { DeviceAnswer } from "./worker-registry";

const POLL_MS = 1_000;
// An ask nobody has claimed by then: no Mac is listening.
const CLAIM_MS = 30_000;

const NO_MAC = "No Mac with Weft open is signed in to this worker's account, so nothing can approve the secrets. Open Weft on your Mac and try again.";
const TOO_LONG = "Nobody approved the secrets on the Mac within 5 minutes. Ask the user, then try again.";

export interface SecretLink {
  ask: (cardId: string, args: SecretAsk) => Promise<string | null>;
  result: (id: string) => Promise<DeviceAnswer | null>;
  cancel: (id: string) => Promise<boolean>;
  // Signs an ask with the worker's pairing key (sign-key.json, H10); absent on a token-enrolled worker.
  sign?: (message: string) => string;
}

export interface WorkerRunRequest {
  cardId?: string;
  thread?: string;
  why?: string;
  root: string;
  cwd: string;
  command: string;
  argv: string[];
  env: Record<string, string>;
  names: string[];
  environment: string;
  script?: string;
  timeoutMs: number;
}

export interface WorkerRunReply {
  denied?: boolean;
  missing?: string[];
  label?: string;
  exitCode?: number | null;
  signal?: string | null;
  timedOut?: boolean;
  output?: string;
  truncated?: boolean;
  ms?: number;
}

type Exec = (req: { argv: string[]; cwd: string; env: Record<string, string>; values: Record<string, string>; timeoutMs: number }, label: string) => Promise<WorkerRunReply>;

export interface RunDeps {
  link: SecretLink | null;
  now: () => number;
  wait: (ms: number) => Promise<unknown>;
  remote: (root: string) => Promise<string | null>;
  exec: Exec;
  // The package.json script the command runs now (lib/secret-command.ts packageScript), read again right before the run.
  script: (argv: string[], cwd: string) => string | undefined;
}

let current: SecretLink | null = null;

// scripts/weft-worker.ts.
export function setSecretLink(next: SecretLink | null) {
  current = next;
}

// A worker card's thread: no control server to reach Electron main through, so the ask goes to the Mac instead.
export const onWorker = () => process.env.WEFT_WORKER === "1" && !process.env.WEFT_SHELL_URL;

const remembered = () => globalSingleton("__weftWorkerSecretValues", () => new Map<string, Map<string, string>>());

function remember(cardId: string, values: Record<string, string>) {
  const kept = remembered().get(cardId) ?? new Map<string, string>();
  for (const [name, value] of Object.entries(values)) kept.set(name, value);
  remembered().set(cardId, kept);
}

/** Drops a card's values once its turn has ended (scripts/weft-worker.ts subscribes this to the bus). */
export function forgetOnTurnEnd(event: BoardEvent) {
  if (event.type === "card" && event.card.column !== "running") remembered().delete(event.card.id);
  if (event.type === "card_deleted") remembered().delete(event.id);
}

/** Text from a worker card's thread with the values it used swapped for ‹NAME›, before it's stored (lib/secret-run.ts redactStored). */
export async function redactOnWorker(cardId: string, text: string): Promise<string> {
  const kept = remembered().get(cardId);
  if (!kept) return text;
  const { redactor } = await import("../electron/secret-redact.cjs");
  return redactor([...kept].map(([name, value]) => ({ name, value })))(text);
}

const gitRemote = (root: string) =>
  new Promise<string | null>((done) => execFile("git", ["-C", root, "remote", "get-url", "origin"], { timeout: 5_000 }, (err, out) => done(err ? null : out.trim())));

const execHere: Exec = async (req, label) => {
  const { createExec, reply } = await import("../electron/secret-exec.cjs");
  const result = await createExec({ spawn, env: cliEnv() }).execute(req);
  return reply(result, Object.entries(req.values).map(([name, value]) => ({ name, value })), label);
};

const DEFAULTS: Omit<RunDeps, "link"> = { now: Date.now, wait: (ms) => new Promise((done) => setTimeout(done, ms)), remote: gitRemote, exec: execHere, script: packageScript };

// The Mac's answer to an ask: queued (the sealed values are on their way), or what the thread hears instead.
type MacAnswer = { queued: boolean; reply: WorkerRunReply };

function macAnswer(raw: unknown): MacAnswer {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const label = typeof r.label === "string" ? r.label : undefined;
  const missing = Array.isArray(r.missing) ? r.missing.filter((n): n is string => typeof n === "string") : [];
  if (r.queued === true) return { queued: true, reply: { label } };
  if (missing.length) return { queued: false, reply: { missing, label } };
  return { queued: false, reply: { denied: true, label } };
}

type Outcome = { values: Record<string, string>; label?: string } | { reply: WorkerRunReply };

// One read of the ask's row before it's queued: the Mac's answer, or null to keep waiting.
async function readAnswer(to: SecretLink, id: string, waited: number): Promise<MacAnswer | null> {
  const answer = await to.result(id);
  if (!answer) throw new Error("The Mac dropped the request. Try again.");
  if (answer.status === "failed") throw new Error(answer.error || "The Mac couldn't answer.");
  if (answer.status === "done") return macAnswer(answer.result);
  if (answer.status === "pending" && waited > CLAIM_MS && (await to.cancel(id))) throw new Error(NO_MAC);
  return null;
}

async function answered(to: SecretLink, id: string, ask: OpenAsk, expiresAt: number, deps: RunDeps): Promise<Outcome> {
  const got: { values?: Record<string, string>; error?: unknown } = {};
  ask.values.then(
    (values) => (got.values = values),
    (err: unknown) => (got.error = err),
  );
  const start = deps.now();
  let queued: { label?: string } | null = null;
  for (;;) {
    if (got.values) return { values: got.values, label: queued?.label };
    if (got.error) throw got.error as Error;
    if (deps.now() > expiresAt) {
      if (!queued) await to.cancel(id).catch(() => false);
      throw new Error(TOO_LONG);
    }
    const mac: MacAnswer | null = queued ? null : await readAnswer(to, id, deps.now() - start);
    if (mac && !mac.queued) return { reply: mac.reply };
    if (mac) queued = { label: mac.reply.label };
    await deps.wait(POLL_MS);
  }
}

/** The worker's mcp__secrets__run, after lib/secret-run.ts has checked and split the command. */
export async function workerSecretRun(req: WorkerRunRequest, given: Partial<RunDeps> = {}): Promise<WorkerRunReply> {
  const deps: RunDeps = { link: current, ...DEFAULTS, ...given };
  const to = deps.link;
  const cardId = req.cardId;
  if (!cardId) throw new Error("Only a card's thread can run a command with secrets.");
  if (!to) throw new Error("This worker can't reach your Mac to ask for secrets. Update it (weft-worker update).");
  if (req.script && hasUnsafeText(req.script, true)) throw new Error("The package.json script this runs holds control or invisible characters (a bidi mark, a zero-width space), so the approval couldn't show it plainly.");
  const remote = await deps.remote(req.root);
  if (!remote) throw new Error("This project has no git remote on the worker, so no vault on your Mac matches it.");
  const nonce = newNonce(randomBytes);
  const expiresAt = deps.now() + ASK_MS;
  const ask = openAsk(nonce, { cardId, command: req.command, names: req.names, environment: req.environment, expiresAt });
  try {
    const cwd = path.relative(req.root, req.cwd) || ".";
    const question: SecretAsk = { nonce, command: req.command, names: req.names, environment: req.environment, cwd, remote, expiresAt, timeoutMs: req.timeoutMs, script: req.script, why: req.why, thread: req.thread };
    // A paired worker signs what the user will approve; main refuses an unsigned ask from it (electron/worker-secret.cjs).
    const id = await to.ask(cardId, to.sign ? { ...question, sig: to.sign(askMessage(cardId, question)) } : question);
    if (!id) throw new Error(NO_MAC);
    const outcome = await answered(to, id, ask, expiresAt, deps);
    if ("reply" in outcome) return outcome.reply;
    // The approval showed the script as it was then: a package.json changed since doesn't get the values.
    if (deps.script(req.argv, req.cwd) !== req.script) throw new Error("The package.json script this runs changed after you asked, so it didn't run. Ask again to approve what it runs now.");
    remember(cardId, outcome.values);
    return await deps.exec({ argv: req.argv, cwd: req.cwd, env: req.env, values: outcome.values, timeoutMs: req.timeoutMs }, outcome.label ?? "your Mac's");
  } finally {
    ask.drop();
  }
}
