import type { PermissionResult, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { messageContent } from "./attachments";
import type { BoardActions } from "./board-tools";
import type { CliProcess } from "./cli-process";
import type { CopilotPersona } from "./copilot-personas";
import type { EditPreview } from "./edit-preview";
import { allowedFolders, keepAliveMinutes } from "./settings";
import type { BoardStatus } from "./status";
import { getCard, updateCard } from "./store";
import { hasLiveTasks } from "./task-ledger";
import type { Backend, CacheState, Card, Effort, PermissionMode, PromptReason, Question } from "./types";
import { globalSingleton } from "./global-singleton";
import { effortFor, modelOn } from "./new-thread";
import { idleToClose, keepAliveFor } from "./puku-idle";
import { offFor } from "./skill-sets";

// What every part of the runner shares: a thread's CLI session, the maps that hold them, and the small
// helpers around them. lib/runner.ts is the front door; lib/runner-session.ts opens and drives sessions,
// lib/runner-turn.ts handles what the CLI sends, lib/runner-ask.ts the permission requests.

export const CLI_NAMES: Record<Backend, string> = { claude: "Claude Code", puku: "puku-cli", codex: "Codex" };

export interface Pending {
  id: string;
  index: number;
  toolName: string;
  title: string;
  input: Record<string, unknown>;
  questions?: Question[];
  readScope?: { directory: string; token: string };
  previewUrl?: string;
  edit?: EditPreview;
  why?: PromptReason;
  waiting?: boolean;
  resolve: (result: PermissionResult) => void;
}

// The user messages for one CLI process, fed in as the user sends them.
export class Inbox implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private wake?: () => void;
  private closed = false;

  // uuid becomes the prompt's id in the session transcript, which is how ↑ finds it to rewind.
  push(text: string, uuid?: string) {
    if (this.closed) throw new Error("This thread's CLI is closing. Send your message again.");
    // Images pasted into the text go along as image blocks (see lib/attachments.ts).
    const message: SDKUserMessage = { type: "user", message: { role: "user", content: messageContent(text) }, parent_tool_use_id: null };
    this.queue.push(uuid ? { ...message, uuid: uuid as SDKUserMessage["uuid"] } : message);
    this.wake?.();
  }

  close() {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator]() {
    for (;;) {
      for (let next = this.queue.shift(); next !== undefined; next = this.queue.shift()) yield next;
      if (this.closed) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
      this.wake = undefined;
    }
  }
}

// What a CLI process is started with. A spare's spec has no session yet.
export interface Spec {
  cwd: string;
  backend: Backend;
  permissionMode: PermissionMode;
  model?: string;
  effort?: Effort;
  sessionId?: string;
  // Continue the session as a copy instead of writing to it.
  forkSession?: boolean;
  // Resume only up to this transcript entry, dropping the turns after it (↑ to edit, editLastMessage).
  resumeAt?: string;
  // Directories the user has approved the thread to read from, beyond cwd. Passed to the SDK as
  // additionalDirectories so the CLI's working-directory restriction lets the thread read there.
  readScope?: string[];
  // The skills and plugins this thread doesn't get (lib/skill-sets.ts), as its CLI starts.
  skillsOff?: string[];
  copilot: boolean;
  // The copilot's persona, whose prompt joins its system prompt (lib/copilot-personas.ts).
  persona?: CopilotPersona;
}

export interface Session {
  build: string;
  // Null while the session is a spare waiting for a new card.
  cardId: string | null;
  spec: Spec;
  query?: Query;
  // The CLI process, in a process group of its own (lib/cli-process.ts).
  process?: CliProcess;
  inbox: Inbox;
  abort: AbortController;
  // True from a sent message until that turn's result.
  busy: boolean;
  stopping: boolean;
  // The latest BOARD STATUS line seen in the current turn.
  status?: BoardStatus;
  // Whether the current turn opened a page in the browser pane (see lib/show.ts).
  openedPane?: boolean;
  // Whether the current turn is the card's wrap-up (/done, or the automations a move to Done queues).
  // Per turn, not per card: a card whose Done move landed mid-turn is wrapping up, but the turn
  // already running is an ordinary one and ends wherever its status line says (lib/turn.ts).
  wrapUp?: boolean;
  // Counts this session's turns, so a late update page from an earlier turn is dropped.
  turnSeq?: number;
  // Parallel tool calls can ask at once; the card shows the oldest.
  pending: Pending[];
  toolIndex: Map<string, number>;
  // Ids of this CLI's tasks that ran in the background, whose end gets a row in the thread (lib/runner-tasks.ts).
  backgrounded?: Set<string>;
  idle?: ReturnType<typeof setTimeout>;
  // What this CLI process's cumulative cost totals are added to (see the result handler).
  costBase?: number;
  // The prompt cache after the last main-agent request: how long it stays warm, and its size in
  // tokens, which is how full the context window is.
  cache?: CacheState;
  // What this CLI process's first message starts with, then cleared: a puku session's system prompt (lib/puku-context.ts).
  preamble?: string;
  // The CLI's session id from its init, kept while a spare so the card that adopts it can resume.
  sessionId?: string;
  // The model its init named, kept the same way so the adopting card's header can show it.
  model?: string;
  // Set once the drive loop has finished; the CLI is gone.
  ended?: boolean;
  // When its last turn ended (or it opened), for closing the least recently used idle CLIs first.
  lastUsed?: number;
  done: Promise<void>;
}

export const sessions = globalSingleton("__weftSessions", () => new Map<string, Session>());
export const spares = globalSingleton("__weftSpares", () => new Map<string, Session>());
// Cards waiting for a CLI login to finish, to run again afterwards.
export const loginWaiters = globalSingleton("__weftLoginWaiters", () => new Map<Backend, Set<string>>());
// Messages waiting to run on a card one turn at a time, such as the skills of board automations.
export const queued = globalSingleton("__weftQueued", () => new Map<string, string[]>());
// Cards moved to Done: archived once the queued Done skills have all run.
export const archiveAfter = globalSingleton("__weftArchiveAfter", () => new Set<string>());

// The turn loop runs from lib/runner.ts's sendMessage through the session and back to its turn queue, so
// the modules below runner.ts reach it through these, which runner.ts fills in as it loads.
export interface RunnerHooks {
  sendQueued: (cardId: string) => void;
  sendHeld: (cardId: string) => void;
  needLogin: (cardId: string, backend: Backend, message: string) => void;
  boardActions: BoardActions;
}
// Every session starts through lib/runner.ts, which sets these as it loads, so none is called before then.
export const hooks = {} as RunnerHooks;

// setTimeout fires at once for anything longer than this.
const MAX_TIMER_MS = 2 ** 31 - 1;

export function close(session: Session) {
  session.inbox.close();
  session.abort.abort();
}

export function isBusy(cardId: string) {
  return sessions.get(cardId)?.busy ?? false;
}

// The cards whose turn is running now.
export function busyCards(): string[] {
  return [...sessions].filter(([, session]) => session.busy).map(([cardId]) => cardId);
}

// The card may be deleted while its thread is still running.
export function safeUpdate(id: string, patch: Partial<Card>) {
  if (getCard(id)) updateCard(id, patch);
}

export function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

// The card's stored effort may be one the backend can't take (e.g. xhigh on puku), so we normalize
// through effortFor at the point we build the spec the CLI actually runs with. A card left over
// from before switchBackend's xhigh guard is caught here on the next turn. Same for a Claude model id
// left on a puku card (modelOn).
// The directories a session may read beyond its folder: what the card was granted, and what the user allowed for every card.
function readScopeFor(card: Card): string[] | undefined {
  const dirs = [...new Set([...(card.readScope ?? []), ...allowedFolders()])];
  return dirs.length ? dirs : undefined;
}

export function specFor(card: Card): Spec {
  return {
    cwd: card.cwd,
    backend: card.backend,
    permissionMode: card.permissionMode,
    model: modelOn(card.backend, card.model),
    effort: effortFor(card.backend, card.effort),
    sessionId: card.sessionId,
    copilot: card.role === "copilot",
    persona: card.role === "copilot" ? card.persona : undefined,
    readScope: readScopeFor(card),
    // The copilot runs the board from your home folder; it keeps every skill, as before.
    skillsOff: card.role === "copilot" ? undefined : offFor(card),
  };
}

// Idle card CLIs kept open at most. Each one holds a CLI plus a copy of every MCP server it starts, so
// with keep-alive at 0 a busy day once left ~40 open and the Mac (and Weft's server) crawling.
export const MAX_IDLE_SESSIONS = 8;

// Closes a card's CLI after the keep-alive time without messages (never, if that's 0), and the least
// recently used idle CLIs past MAX_IDLE_SESSIONS (MAX_IDLE_PUKU for puku, lib/puku-idle.ts). A closed card resumes its session on the next message.
export function scheduleIdle(session: Session) {
  clearTimeout(session.idle);
  session.lastUsed = Date.now();
  trimIdle();
  const cardId = session.cardId;
  // A picked-up session's CLI, or a puku one, closes after 10 idle minutes at most, for the same reason.
  const imported = getCard(cardId ?? "")?.source === "claude-code";
  const minutes = keepAliveFor(session.spec.backend, imported, keepAliveMinutes());
  if (!cardId || minutes <= 0) return;
  session.idle = setTimeout(() => closeWhenIdle(cardId, session), Math.min(minutes * 60_000, MAX_TIMER_MS));
}

function trimIdle() {
  const idle = [...sessions.entries()]
    .filter(([cardId, s]) => !s.busy && !s.spec.copilot && s.pending.length === 0 && !s.ended && !hasLiveTasks(cardId))
    .sort(([, a], [, b]) => (a.lastUsed ?? 0) - (b.lastUsed ?? 0));
  const toClose = new Set(idleToClose(idle.map(([, s]) => s), MAX_IDLE_SESSIONS));
  for (const [cardId, s] of idle) {
    if (!toClose.has(s)) continue;
    clearTimeout(s.idle);
    closeWhenIdle(cardId, s);
  }
}

function closeWhenIdle(cardId: string, session: Session) {
  if (sessions.get(cardId) !== session || session.busy) return;
  // Closing it would end the subagents and commands running in its process group: check again later.
  if (hasLiveTasks(cardId)) {
    scheduleIdle(session);
    return;
  }
  sessions.delete(cardId);
  session.inbox.close();
  // If the CLI doesn't exit on its own once its input ends, end it.
  setTimeout(() => session.abort.abort(), 10_000);
}
