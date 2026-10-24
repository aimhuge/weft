import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { isDoneCommand, skillsForPrompt } from "./automations";
import { lastSent } from "./edit-last";
import { showStarter } from "./show";
import { isOpenElsewhere } from "./import";
import { holdForRestart } from "./restart-when-idle";
import { sessionRewindPoint } from "./rewind";
import { addScheduled } from "./schedule";
import { answerPermission, settle } from "./runner-pending";
import { needLogin } from "./runner-login";
import { adoptSpare, currentSession, open } from "./runner-session";
import { withShellContext } from "./shell";
import { switchSpare } from "./spare-switch";
import { archiveAfter, close, errorText, hooks, isBusy, queued, safeUpdate, sessions, specFor, type Session } from "./runner-state";
import { panePage } from "./pane-page";
import { findDescendantGroups, signalGroups } from "./process-tree";
import { skillInvocation } from "./skills";
import { appendThread, foldThread, getCard, getThread, updateCard } from "./store";
import { takeTaskNote } from "./task-ledger";
import { takeBreakNote } from "./crash-blame";
import type { Card, PermissionMode } from "./types";
import { awaitingWorktree, workDir } from "./work-dir";
import { isolate } from "./worktree-start";
import { landCard } from "./worktree-done";

// One Agent SDK query() per thread: what the board and the API call to send, stop, queue and answer.
// The parts behind it: lib/runner-state.ts (sessions and the shared maps), lib/runner-session.ts (starting
// and driving a CLI, spares), lib/runner-turn.ts (what the CLI sends during a turn), lib/runner-ask.ts
// (permission requests), lib/runner-pending.ts (answering one), lib/permission-wait.ts (holding one
// until another card lets go of the code), lib/runner-login.ts (auth wall).
export { switchBackend } from "./backend-switch";
export { rerunOnModel } from "./backend-switch";
export { answerPermission } from "./runner-pending";
export { waitPermission } from "./permission-wait";
export { ensureSpare, warmUp } from "./runner-session";
export { isBusy } from "./runner-state";
// Re-exports for the login module (used by app/api/login and lib/copilot.ts).
export { clearLoginWaiters, retryAfterLogin, retryPukuWithTrial } from "./runner-login";

// A picked-up session that's open in another app, or that changed outside Weft in the last 10 minutes.
function activeElsewhere(card: Card) {
  if (card.source !== "claude-code" || !card.sessionId || card.forkedFrom) return false;
  const outside = (card.lastActivity ?? 0) > (card.lastWeftTurn ?? 0) + 5_000;
  if (outside && Date.now() - (card.lastActivity ?? 0) < 10 * 60_000) return true;
  return isOpenElsewhere(card.sessionId);
}

// Saves a card's permission mode and applies it to its open CLI, mid-turn included.
export function setPermissionMode(cardId: string, mode: PermissionMode) {
  updateCard(cardId, { permissionMode: mode });
  const session = sessions.get(cardId);
  if (!session || session.spec.permissionMode === mode) return;
  session.spec.permissionMode = mode;
  void session.query?.setPermissionMode(mode).catch(() => {});
}

// Saves a card's model and applies it to its open CLI, so a warm thread keeps its session (BackendPicker).
// switchSpare also signs its commits as the new model.
// The stats' runsOn follows the model, so the header's chip and the status strip name the model the
// thread is on now, not the one it was on when it last reported.
export function setModel(cardId: string, model: string) {
  const card = getCard(cardId);
  const effort = card?.effort;
  const stats = card?.stats;
  updateCard(cardId, {
    model,
    ...(stats ? { stats: { ...stats, runsOn: { model, effort } } } : {}),
  });
  const session = sessions.get(cardId);
  if (session) switchSpare(session.query, session.spec, { permissionMode: session.spec.permissionMode, model });
}

// A message that can't go yet waits: for a restart the running turns hold up (it goes after it), or for an
// isolated card's worktree (lib/worktree-start.ts), which it then goes out in.
function holdSend(card: Card, text: string, { echo, cli }: { echo: boolean; cli: string }) {
  if (holdForRestart(card.id, text, { echo })) return true;
  if (!awaitingWorktree(card)) return false;
  void isolate(card.id, () => sendMessage(card.id, text, { echo, cli }));
  return true;
}

// `cli` is what the CLI gets when it differs from what the thread shows (the copilot's board digest).
export function sendMessage(cardId: string, text: string, { echo = true, cli = text } = {}) {
  const card = getCard(cardId);
  if (!card) throw new Error("No such card.");
  if (holdSend(card, text, { echo, cli })) return;
  const session = sessionFor(card);
  // Claude threads tag the prompt so ↑ can rewind its turn later (lib/edit-last.ts).
  const promptId = card.backend === "claude" && !session.spec.copilot ? randomUUID() : undefined;
  if (echo) {
    const page = panePage(cardId);
    appendThread(cardId, { kind: "user", text, at: Date.now(), ...(promptId && { id: promptId }), ...(page && { page }) });
  }
  const fresh = { error: undefined, suggestion: undefined, pending: null, interrupted: undefined, resumes: undefined };
  updateCard(cardId, { column: "running", archived: false, wrappingUp: archiveAfter.has(cardId), ...fresh, lastLine: "Thinking…" });
  clearTimeout(session.idle);
  session.busy = true;
  session.status = undefined;
  session.openedPane = false;
  // Whether this turn is the card's wrap-up. Per turn: a card whose Done move landed mid-turn is
  // wrapping up, but the turn already running is an ordinary one (lib/turn.ts columnAfterTurn).
  session.wrapUp = isDoneCommand(text);
  session.turnSeq = (session.turnSeq ?? 0) + 1;
  // puku doesn't run .claude/skills as slash commands, so a /skill message goes as the skill's instructions.
  const forCli = card.backend === "puku" ? skillInvocation(cli, card.cwd, { weft: false }) : cli;
  // Ahead of it, a note about subagents its CLI lost since the last message (lib/tasks.ts taskNote), and about the time
  // it broke Weft (lib/crash-blame.ts).
  session.inbox.push(`${session.preamble ?? ""}${takeTaskNote(cardId)}${takeBreakNote(cardId)}${forCli}`, promptId);
  keepSessionId(cardId, session);
  session.preamble = undefined;
  if (!session.spec.copilot) showStarter(cardId, card.title, text).catch(() => {});
}

// A new conversation's id is Weft's own (lib/runner-session.ts open), so the card keeps it from the first
// message: stopped before the CLI's init, the next message still resumes this conversation.
function keepSessionId(cardId: string, session: Session) {
  if (!getCard(cardId)?.sessionId && session.sessionId && !session.spec.sessionId) updateCard(cardId, { sessionId: session.sessionId });
}

// The card's CLI for the next message: its open one, a copy when another app has the session, a spare, or a new one.
function sessionFor(card: Card) {
  const session = currentSession(card.id);
  if (session?.busy) throw new Error("This thread is already running.");
  if (session) return session;
  if (awaitingWorktree(card)) throw new Error("This card's worktree isn't ready yet; it starts as soon as it is.");
  if (!fs.existsSync(workDir(card))) throw new Error(`This thread's folder ${workDir(card)} doesn't exist anymore.`);
  if (activeElsewhere(card)) {
    // Two apps writing one session would split the conversation, so continue it as a copy.
    const copy = open({ ...specFor(card), forkSession: true }, card.id);
    updateCard(card.id, { forkedFrom: card.sessionId, openElsewhere: false });
    return copy;
  }
  return adoptSpare(card) ?? open(specFor(card), card.id);
}

// A message you typed: sent now (a /done one archives the card once it's run), then the skills that "a prompt matches" rules want for it follow as
// their own turns, once per thread per skill.
export function sendUserMessage(cardId: string, text: string, { cli = text } = {}) {
  const card = getCard(cardId);
  if (!card) throw new Error("No such card.");
  // Held before its shell output and skills are taken, so they go with it after the restart.
  if (holdForRestart(cardId, text)) return;
  // Mid-turn (a page's link, a failed commit's note): it waits on the card and goes as the turn ends.
  if (holdForTurn(card, text)) return;
  // What your "!" commands printed since your last message goes along with it (lib/shell.ts).
  sendMessage(cardId, text, { cli: withShellContext(cardId, cli) });
  // /done files the card away when its turn ends, as a move to Done does.
  if (isDoneCommand(text)) archiveWhenIdle(cardId);
  const skills = skillsForPrompt(card, text);
  if (!skills.length) return;
  updateCard(cardId, { promptSkills: [...(card.promptSkills ?? []), ...skills] });
  queueMessages(cardId, skills.map((skill) => `/${skill}`));
}

// A message for a thread that's mid-turn waits on the card as "after this turn" (the reply box's queue
// shows it, and you can pull it back) instead of being turned away. The copilot has no such queue.
function holdForTurn(card: Card, text: string) {
  if (!isBusy(card.id) || card.role === "copilot") return false;
  updateCard(card.id, { scheduled: addScheduled(card.scheduled, { id: randomUUID(), text, at: Date.now(), afterTurn: true }) });
  return true;
}

// As a turn ends: what waited for it goes out as one message, in the order it came.
function sendHeld(cardId: string) {
  const scheduled = getCard(cardId)?.scheduled ?? [];
  const held = scheduled.filter((m) => m.afterTurn);
  if (!held.length || isBusy(cardId)) return;
  const rest = scheduled.filter((m) => !m.afterTurn);
  updateCard(cardId, { scheduled: rest.length ? rest : undefined });
  try {
    sendUserMessage(cardId, held.map((m) => m.text).join("\n\n"));
  } catch (err) {
    safeUpdate(cardId, { error: `A message that waited for the turn couldn't go: ${errorText(err)}` });
  }
}

// ↑ in the reply box: your last message, rewritten. Its turn is stopped if it's still running, rewound
// out of the conversation and folded away in the thread, then the new text goes out in its place.
// Files that turn changed stay as they are. A message the CLI's transcript doesn't hold (a picked-up
// session, a puku thread, one sent before ↑ could edit) can't be rewound, so the text goes out as a
// new message after it.
export async function editLastMessage(cardId: string, text: string) {
  const before = getCard(cardId);
  if (!before) throw new Error("No such card.");
  if (before.role === "copilot") throw new Error("The copilot's messages can't be edited.");
  const last = lastSent(getThread(cardId));
  if (!last) throw new Error("There's no message to edit yet.");
  // Closing the CLI ends a running turn and leaves its transcript complete for the read below.
  await endSession(cardId);
  queued.delete(cardId);
  archiveAfter.delete(cardId);
  const card = getCard(cardId) ?? before;
  const at = last.promptId && card.sessionId ? sessionRewindPoint(card.sessionId, last.promptId) : undefined;
  if (at !== undefined) {
    foldThread(cardId, last.index);
    if (at === null) {
      // It was the session's first message, so the edit starts a new one.
      open({ ...specFor(card), sessionId: undefined }, cardId);
    } else {
      // Rewinding writes to the session, so one open in another app is continued as a copy.
      const forkSession = activeElsewhere(card);
      if (forkSession) updateCard(cardId, { forkedFrom: card.sessionId, openElsewhere: false });
      open({ ...specFor(card), resumeAt: at, forkSession }, cardId);
    }
  }
  sendUserMessage(cardId, text);
}

// Runs each message as its own turn, in order, starting now if the card is idle. A turn that's
// stopped or fails drops the rest; one that ends needing you waits for your reply's turn to end.
export function queueMessages(cardId: string, texts: string[]) {
  if (!texts.length) return;
  queued.set(cardId, [...(queued.get(cardId) ?? []), ...texts]);
  sendQueued(cardId);
}

// Archives the card in Done once the messages queued for it have run (now, if there are none); until
// then it's wrappingUp and the board draws it in Done. A stopped or failed turn sends it to Review
// unarchived, and a starred card stays on the board (★: worth keeping).
export function archiveWhenIdle(cardId: string) {
  if (queued.has(cardId) || isBusy(cardId)) archiveAfter.add(cardId);
  // With no wrap-up turn to wait for, an isolated card lands its branch now (lib/worktree-done.ts).
  if (!archiveAfter.has(cardId) && getCard(cardId)?.worktree) {
    hooks.land(cardId);
    return;
  }
  updateCard(cardId, archiveAfter.has(cardId) ? { wrappingUp: true } : { archived: !getCard(cardId)?.starred });
}

// Restores the card's model/effort if a Done move patched them for the /weft:done turn (app/api/cards/[id]
// moveCard applies the override from lib/automations doneOverrides). The card stores the originals as
// preDoneModel / preDoneEffort; clearing them here returns the card to its real picks. A no-op when the
// turn wasn't started by a Done move (e.g. the user typed /weft:done themselves).
export function restoreDoneOverride(cardId: string) {
  const card = getCard(cardId);
  if (!card) return;
  if (card.preDoneModel === undefined && card.preDoneEffort === undefined && card.preDoneBackend === undefined) return;
  const patch: {
    preDoneModel: undefined;
    preDoneEffort: undefined;
    preDoneBackend: undefined;
    model?: string;
    effort?: typeof card.effort;
    backend?: typeof card.backend;
  } = {
    preDoneModel: undefined,
    preDoneEffort: undefined,
    preDoneBackend: undefined,
  };
  if (card.preDoneModel !== undefined) patch.model = card.preDoneModel;
  if (card.preDoneEffort !== undefined) patch.effort = card.preDoneEffort;
  if (card.preDoneBackend !== undefined) patch.backend = card.preDoneBackend;
  updateCard(cardId, patch);
}

function sendQueued(cardId: string) {
  if (isBusy(cardId)) return;
  const queue = queued.get(cardId) ?? [];
  const text = queue.shift();
  if (!queue.length) queued.delete(cardId);
  if (!text) return;
  try {
    sendMessage(cardId, text);
  } catch (err) {
    queued.delete(cardId);
    safeUpdate(cardId, { error: errorText(err) });
  }
}

// How long the CLI gets to end an interrupted turn before its process is ended.
const STOP_GRACE_MS = 1_500;

// Ends the current turn but keeps the thread's CLI open.
export async function stop(cardId: string) {
  const session = sessions.get(cardId);
  if (!session) return;
  while (session.pending.length) settle(cardId, false);
  if (!session.busy) return;
  session.stopping = true;
  if (session.spec.backend === "codex") {
    session.abort.abort();
    await session.done;
    return;
  }
  // SIGTERM the commands the CLI is running first, so a long Bash call ends at once instead of after the interrupt.
  const pgid = session.process?.pid;
  if (pgid) signalGroups(findDescendantGroups(pgid), "SIGTERM");
  // If the CLI doesn't end the turn (it may still be starting, or stuck), end the process.
  setTimeout(() => {
    if (session.busy && session.stopping) session.abort.abort();
  }, STOP_GRACE_MS);
  try {
    await Promise.race([session.query?.interrupt(), new Promise((resolve) => setTimeout(resolve, STOP_GRACE_MS))]);
  } catch {
    session.abort.abort();
  }
}

// Closes the thread's CLI. Resolves once it has fully wound down.
export async function endSession(cardId: string) {
  const session = sessions.get(cardId);
  if (!session) return;
  while (session.pending.length) settle(cardId, false);
  sessions.delete(cardId);
  close(session);
  await session.done;
}

// Runs the thread's last message again, in a fresh CLI (after a login, for example).
export async function retry(cardId: string) {
  if (isBusy(cardId)) return;
  await endSession(cardId);
  const last = [...getThread(cardId)].reverse().find((item) => item.kind === "user");
  if (last?.kind === "user" && getCard(cardId) && !isBusy(cardId)) sendMessage(cardId, last.text, { echo: false });
}

// What the session and turn modules call back into (lib/runner-state.ts hooks), and the board tools' actions.
hooks.sendQueued = sendQueued;
hooks.sendHeld = sendHeld;
hooks.needLogin = needLogin;
hooks.land = (id) => void landCard(id, (cardId, text) => sendMessage(cardId, text));
hooks.boardActions = {
  start: (cardId: string, text: string) => sendMessage(cardId, text),
  stop,
  answer: answerPermission,
  isBusy,
};
