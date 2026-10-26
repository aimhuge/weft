import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { signAsWeft } from "./attribution";
import { isTrustedTool } from "./board-tools";
import { runsOn } from "./cli-defaults";
import { executableFor } from "./cli-path";
import { onElicitation } from "./elicitation";
import { spawnCli, withStderr } from "./cli-process";
import { withRetryGrant } from "./classifier-denial";
import { askAboutCall } from "./guards/ask";
import { guardedCli } from "./env";
import { isNotLoggedInError, isRateLimitError } from "./login";
import { isLostSessionError, resumeLostSession } from "./lost-session";
import { hitRateLimit } from "./rate-limit";
import { askUser } from "./runner-ask";
import { settle } from "./runner-pending";
import { close, hooks, Inbox, queued, safeUpdate, scheduleIdle, sessions, spares, specFor, type Session, type Spec } from "./runner-state";
import { TURN_CODE, handle } from "./runner-turn";
import { defaultPermissionMode } from "./settings";
import { pukuContext } from "./puku-context";
import { trialOptions } from "./puku-trial";
import { PLUGIN_DIR } from "./skills";
import { ensureSeeded, offFor, sameOff, withSkillSettings } from "./skill-sets";
import { switchSpare } from "./spare-switch";
import { backendEnv, refillsSpare } from "./puku-idle";
import { subagentEnv, subagentModelFor, subagentPrompt, type SubagentModel } from "./subagents";
import { weftMcpServers } from "./weft-mcp";
import { promptsBuild, weftSystemPrompt } from "./weft-prompts";
import { CODEX_CODE, driveCodex } from "./codex-runner";
import { GOOSE_RUNNER_CODE, driveGoose } from "./goose-runner";
import { getCard, updateCard } from "./store";
import { loseTasks } from "./task-ledger";
import * as turnRules from "./turn";
import type { Backend, Card } from "./types";
import { awaitingWorktree, workDir } from "./work-dir";

// A thread's CLI process: started (or a spare taken over), driven through the Agent SDK until it ends,
// and replaced when the code it runs is out of date.

// Spare CLIs started ahead of time, one per recent project folder, so a new card doesn't wait.
const MAX_SPARES = 3;

// A fingerprint of the runner's code. In development a code change reloads the module, but sessions
// the old code started keep running it, so idle ones are replaced instead of reused. It's derived from
// the code (not random) because each API route can load its own copy of these modules. The pure turn
// rules in turn.ts count too: a session started before they changed would still run the old ones.
const BUILD = createHash("sha1")
  .update([drive, driveCodex, driveGoose, queryOptions, threadEnv, weftMcpServers, weftSystemPrompt, subagentPrompt, ...CODEX_CODE, ...GOOSE_RUNNER_CODE, ...TURN_CODE, askUser, askAboutCall, settle, onElicitation, ...Object.values(turnRules)].map(String).join("\n"))
  .digest("hex");

// The code fingerprint plus what a CLI only reads when it starts: the content of Weft's pinned prompts
// (lib/weft-prompts.ts) and the settings they're built from (thread prompt, subagent model), so editing
// a prompt or changing one in Settings replaces idle sessions too.
function currentBuild() {
  return `${BUILD}:${promptsBuild()}`;
}

function isStale(session: Session) {
  return session.ended || (session.build !== currentBuild() && !session.busy);
}

// The card's open session, unless it's a stale one (which is closed here).
export function currentSession(cardId: string): Session | undefined {
  const session = sessions.get(cardId);
  if (session && isStale(session)) {
    sessions.delete(cardId);
    close(session);
    return undefined;
  }
  return session;
}

function spareKey(backend: Backend, cwd: string) {
  return `${backend}|${cwd}`;
}

export function open(spec: Spec, cardId: string | null): Session {
  const executable = executableFor(spec.backend);
  const session: Session = {
    build: currentBuild(),
    cardId,
    spec,
    inbox: new Inbox(),
    abort: new AbortController(),
    busy: false,
    stopping: false,
    pending: [],
    toolIndex: new Map(),
    done: Promise.resolve(),
    preamble: spec.backend === "puku" ? pukuContext(spec.cwd, weftSystemPrompt(spec), spec.skillsOff) : undefined,
    // A new conversation gets its id from Weft (--session-id), not from the CLI's init: puku can take 15s or more
    // to send init, and a turn stopped before then left the card nothing to resume, so "continue" began a new one.
    sessionId: spec.backend === "codex" || spec.sessionId ? undefined : randomUUID(),
  };
  if (cardId) sessions.set(cardId, session);
  session.done = drive(session, executable);
  scheduleIdle(session);
  return session;
}

// Starts a card's CLI without sending anything, so its next message starts right away.
export function warmUp(cardId: string) {
  const card = getCard(cardId);
  if (!card || currentSession(cardId)) return;
  // Picked-up sessions only start a CLI when you send something, so Weft never holds a session
  // the Claude app might reopen.
  if (card.source === "claude-code" || awaitingWorktree(card) || !fs.existsSync(workDir(card))) return;
  try {
    open(specFor(card), cardId);
  } catch {}
}

// Keeps a spare CLI open in a project folder for the next new card there.
export function ensureSpare(cwd: string, backend: Backend = "claude") {
  // Codex and Goose start a fresh process for every turn, so there is no spare process to keep warm.
  if (backend === "codex" || backend === "goose") return;
  const key = spareKey(backend, cwd);
  const existing = spares.get(key);
  if (existing && !isStale(existing)) return;
  if (existing) {
    spares.delete(key);
    close(existing);
  }
  // One puku spare at most: the folder the New thread dialog asked for last.
  if (backend === "puku") {
    for (const [k, s] of spares) {
      if (s.spec.backend !== "puku") continue;
      spares.delete(k);
      close(s);
    }
  }
  const oldest = spares.entries().next().value;
  if (spares.size >= MAX_SPARES && oldest) {
    spares.delete(oldest[0]);
    close(oldest[1]);
  }
  try {
    // Spares start in the default mode new cards get, so most take one over without a mode switch.
    ensureSeeded(cwd);
    spares.set(key, open({ cwd, backend, permissionMode: defaultPermissionMode(), copilot: false, skillsOff: offFor({ cwd }) }, null));
  } catch {}
}

export function adoptSpare(card: Card): Session | undefined {
  // A spare runs in the project folder, so an isolated card (whose CLI runs in its worktree) starts its own.
  if (card.sessionId || card.forkOf || card.role === "copilot" || card.isolated) return undefined;
  // A spare starts with Builder's soul, and a CLI reads its system prompt as it starts (lib/agents.ts).
  if (card.agent) return undefined;
  const key = spareKey(card.backend, card.cwd);
  const spare = spares.get(key);
  if (!spare || spare.abort.signal.aborted || spare.ended) return undefined;
  // A CLI reads its skills as it starts, so a card with a set of its own starts its own.
  if (!sameOff(spare.spec.skillsOff, offFor(card))) return undefined;
  spares.delete(key);
  if (isStale(spare)) {
    close(spare);
    return undefined;
  }
  spare.cardId = card.id;
  sessions.set(card.id, spare);
  switchSpare(spare.query, spare.spec, card);
  // The spare's init came before it had a card; without its id a CLI that dies mid-turn can't resume.
  // Its model is the CLI's default unless the switch above gave it the card's.
  const ran = runsOn(card.model ?? spare.model, card);
  safeUpdate(card.id, { warm: true, ...(spare.sessionId ? { sessionId: spare.sessionId } : {}), ...(ran ? { stats: { ...card.stats, runsOn: ran } } : {}) });
  scheduleIdle(spare);
  if (refillsSpare(card.backend)) setTimeout(() => ensureSpare(card.cwd, card.backend), 0);
  return spare;
}

// The copilot runs the board, not code, so subagent settings are for threads only.
// The subagent model is read fresh for every turn, so a change in Settings takes effect on the
// thread's next message instead of when its session happens to start (lib/subagents.ts subagentModelFor).
function threadEnv(spec: Spec, env: Options["env"], subagents: SubagentModel) {
  return spec.copilot ? env : { ...env, ...subagentEnv(subagents, spec.backend) };
}

// What a session's CLI is started with: its spec, Weft's prompts, tools and skills, and the permission hook.
function queryOptions(session: Session, executable: string | undefined): Options {
  const { spec } = session;
  const cardId = () => session.cardId ?? undefined;
  const guarded = guardedCli(() => [...sessions.values()].filter((s) => s.busy && s !== session).length, cardId);
  const subagents = subagentModelFor();
  // A puku thread with no Puku login of its own runs on Weft's Puku trial while you're signed in to Weft.
  const trial = spec.backend === "puku" ? trialOptions() : null;
  const logStderr = (data: string) => console.error(`[thread ${(session.cardId ?? "spare").slice(0, 8)}] ${data.trimEnd()}`);
  return {
    cwd: spec.cwd,
    // Directories the user approved reading from beyond cwd (Card.readScope, Spec.readScope).
    // Forwarded to the SDK as additionalDirectories so the CLI's working-directory gate lets the
    // thread read there without an extra prompt.
    additionalDirectories: spec.readScope,
    resume: spec.sessionId,
    sessionId: spec.sessionId ? undefined : session.sessionId,
    forkSession: spec.sessionId ? spec.forkSession : undefined,
    resumeSessionAt: spec.sessionId ? spec.resumeAt : undefined,
    ...withRetryGrant(guarded, session),
    env: { ...threadEnv(spec, guarded.env, subagents), ...backendEnv(spec.backend), ...trial?.env },
    settings: withSkillSettings(trial?.settings, spec.skillsOff),
    abortController: session.abort,
    includePartialMessages: true,
    permissionMode: spec.permissionMode,
    model: spec.model,
    effort: spec.effort,
    // So a card can switch to bypassPermissions later, including a spare it takes over.
    // Puku-cli's CLI doesn't accept this flag, so only forward it to the Claude Code binary.
    allowDangerouslySkipPermissions: spec.backend === "claude" && !spec.copilot ? true : undefined,
    pathToClaudeCodeExecutable: executable,
    // A guessed next message after each turn, for the reply box's Tab (it rides the turn's prompt cache).
    promptSuggestions: spec.backend === "claude" && !spec.copilot ? true : undefined,
    // Weft's own skills (plugin/skills), so board threads can run /weft:done and the like.
    plugins: !spec.copilot && fs.existsSync(PLUGIN_DIR) ? [{ type: "local", path: PLUGIN_DIR }] : undefined,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: weftSystemPrompt(spec),
    },
    mcpServers: weftMcpServers(spec, cardId),
    canUseTool: (toolName, input, opts) => {
      if (isTrustedTool(toolName, opts.mcpServer?.source)) {
        return Promise.resolve({ behavior: "allow", updatedInput: input });
      }
      // Everything past Weft's own tools is the guards' shared ask (lib/guards/ask.ts), which Codex and Goose use too.
      return askAboutCall(session, toolName, input, opts.toolUseID, opts.signal, opts.title);
    },
    // An MCP server asking you something (the Supabase MCP confirming destructive SQL) becomes a prompt on the
    // card instead of the SDK's silent decline (lib/elicitation.ts).
    onElicitation: onElicitation(session, askUser),
    // Its own spawn, so ending the session ends puku-cli's `Puku` child too (lib/cli-process.ts).
    spawnClaudeCodeProcess: (opts) => (session.process = spawnCli(opts, logStderr)),
  };
}

async function drive(session: Session, executable: string | undefined) {
  // Let open() finish registering the session before anything below can fail and clean it up.
  await Promise.resolve();
  try {
    if (session.spec.backend === "codex") {
      if (!executable) throw new Error("Codex CLI isn't on this app's PATH.");
      await driveCodex(session, executable);
      return;
    }
    if (session.spec.backend === "goose") {
      if (!executable) throw new Error("goose isn't on this app's PATH.");
      await driveGoose(session, executable);
      return;
    }
    session.query = query({ prompt: session.inbox, options: queryOptions(session, executable) });
    if (session.cardId) safeUpdate(session.cardId, { warm: true });
    for await (const msg of session.query) {
      const cardId = session.cardId;
      if (msg.type === "system" && msg.subtype === "init") [session.sessionId, session.model] = [msg.session_id, msg.model];
      if (msg.type === "system" && msg.subtype === "init") signAsWeft(session.query, session.spec, session.spec.model ?? msg.model);
      // A spare's startup messages belong to no card yet.
      if (!cardId) continue;
      if (!getCard(cardId)) {
        session.abort.abort();
        break;
      }
      await handle(cardId, session, msg);
    }
  } catch (err) {
    failed(session, err);
  } finally {
    wrapUp(session);
  }
}

// The CLI failed (not stopped by us): a plan limit, a logged-out CLI, or an error kept on the card.
function failed(session: Session, err: unknown) {
  const cardId = session.cardId;
  if (!cardId || session.abort.signal.aborted) return;
  const message = withStderr(err instanceof Error ? err.message : String(err), session.process?.stderrTail());
  if (isLostSessionError(message) && resumeLostSession(cardId, session.spec.sessionId)) return;
  if (isRateLimitError(message)) hitRateLimit(cardId, session.spec.backend, message);
  else if (isNotLoggedInError(message)) hooks.needLogin(cardId, session.spec.backend, message);
  else safeUpdate(cardId, { error: message });
}

// The CLI is gone: forget the session, and a card it left mid-turn goes to Review.
function wrapUp(session: Session) {
  session.ended = true;
  clearTimeout(session.idle);
  const cardId = session.cardId;
  if (!cardId) {
    for (const [key, spare] of spares) if (spare === session) spares.delete(key);
    return;
  }
  // (A session that was replaced by a newer one leaves the card to it.)
  if (sessions.has(cardId) && sessions.get(cardId) !== session) return;
  sessions.delete(cardId);
  const latest = getCard(cardId);
  if (!latest) return;
  loseTasks(cardId);
  const live = latest.column === "running" || Boolean(latest.pending);
  // The CLI ended mid-turn, so whatever was queued after that turn doesn't run.
  if (live) queued.delete(cardId);
  updateCard(cardId, {
    warm: false,
    ...(live ? { column: "review" as const, pending: null, lastLine: "Stopped" } : {}),
  });
}
