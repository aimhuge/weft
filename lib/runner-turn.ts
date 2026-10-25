import type { ModelUsage, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import { recordLimit } from "./activity";
import { publish } from "./bus";
import { switchToBackup } from "./backend-switch";
import { runsOn } from "./cli-defaults";
import { editPreview } from "./edit-preview";
import { firstLine, shortToolName, summarizeInput, toolAction } from "./format";
import { askAboutDenials, noteDenial } from "./classifier-denial";
import { changedLines, gitBranch } from "./git-stats";
import { showAfterTurn } from "./show";
import { recordLimits } from "./limit-history";
import { modelCapFor, planWindowOf, recordModelCaps } from "./limit-kind";
import { recordModelLimit } from "./model-limit";
import { isNotLoggedInError, isRateLimitError } from "./login";
import { isLostSessionError, resumeLostSession } from "./lost-session";
import { editedPath, touchFile } from "./overlap";
import { hitRateLimit } from "./rate-limit";
import { extractReview } from "./review";
import { archiveAfter, hooks, queued, safeUpdate, scheduleIdle, type Session } from "./runner-state";
import { handleTaskEvent } from "./runner-tasks";
import { waitingInCli } from "./runner-steer";
import { restoreDoneOverride } from "./runner";
import { withRedacted } from "./secret-run";
import { secretAskOf } from "./vault-view";
import { recordTask } from "./task-ledger";
import { extractStatus, type BoardStatus } from "./status";
import { appendThread, getCard, getThread, replaceThreadItem } from "./store";
import { adoptLocalMedia, liveToolResult, type ToolResult } from "./thread-media";
import { cacheAfter, columnAfterTurn, eventWindow, modelStats, readResult, turnCost, usageWindow } from "./turn";
import type { Backend, CardStats } from "./types";

// What a card's CLI sends during a turn, put on the card and its thread: streamed text, replies, tool calls
// and results, rate limits, and the result that ends the turn (lib/runner-session.ts's drive loop calls handle).

// Sync except for tool results from a card that used vault secrets, which wait on their redaction.
export function handle(id: string, session: Session, msg: SDKMessage): void | Promise<void> {
  switch (msg.type) {
    case "system":
      handleSystem(id, session, msg);
      break;

    case "rate_limit_event":
      handleRateLimit(id, session.spec.backend, msg.rate_limit_info);
      break;

    case "stream_event": {
      if (msg.parent_tool_use_id) break;
      const ev = msg.event;
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        publish({ type: "delta", cardId: id, text: ev.delta.text });
      }
      break;
    }

    case "assistant":
      // Subagent turns stay out of the card's thread; their final report arrives as a tool result.
      if (!msg.parent_tool_use_id) handleAssistant(id, session, msg);
      break;

    case "user":
      return handleToolResults(id, session, msg);

    case "result":
      handleResult(id, session, msg);
      break;

    case "prompt_suggestion":
      handleSuggestion(id, msg.suggestion);
      break;
  }
}

// The CLI's init, a call auto mode's classifier denied (lib/classifier-denial.ts), or a background task's event.
function handleSystem(id: string, session: Session, msg: Extract<SDKMessage, { type: "system" }>) {
  recordTask(id, msg);
  if (msg.subtype === "init") {
    safeUpdate(id, { sessionId: msg.session_id });
    const card = getCard(id);
    const ran = card && runsOn(msg.model, card);
    if (ran) updateStats(id, { runsOn: ran });
    void refreshLimits(id, session);
  } else if (msg.subtype === "permission_denied") noteDenial(session, msg);
  else handleTaskEvent(id, session, msg);
}

function handleRateLimit(id: string, backend: Backend, info: Extract<SDKMessage, { type: "rate_limit_event" }>["rate_limit_info"]) {
  const card = getCard(id);
  const at = Date.now();
  // A per-model cap ("seven_day_opus") is that MODEL's own limit, not the plan's: it belongs in
  // the per-model store (lib/model-limit.ts), so it gates that model alone. Filed as a plan
  // window instead, it would gate every model on the pool and picking another model would not
  // help (lib/limit-kind.ts).
  const capped = modelCapFor(card?.model, info.rateLimitType);
  if (info.status === "rejected" && capped) {
    recordModelLimit(capped, at, info.resetsAt ? info.resetsAt * 1000 : undefined);
    return;
  }
  // A refused request is a limit hit, for the limit badges and the wefter card's chart.
  const kind = planWindowOf(info.rateLimitType);
  if (info.status === "rejected" && kind && card) recordLimit(kind, at, card, info.resetsAt);
  const window = eventWindow(info);
  if (!window) return;
  if (info.rateLimitType === "five_hour") updateLimits(id, backend, { fiveHour: window });
  else if (info.rateLimitType === "seven_day") updateLimits(id, backend, { sevenDay: window });
}

// The CLI's guess at your next message, for the reply box's placeholder and Tab.
function handleSuggestion(id: string, suggestion: string) {
  const text = suggestion.trim();
  if (text) safeUpdate(id, { suggestion: text });
}

// The agent's reply: its text goes to the thread (status and review blocks lifted onto the card), and
// each tool call gets a thread item its result fills in later.
function handleAssistant(id: string, session: Session, msg: Extract<SDKMessage, { type: "assistant" }>) {
  if (!session.busy) safeUpdate(id, { column: "running" }); // went on after its turn ended: a restart must find it running
  session.busy = true;
  session.cache = cacheAfter(msg.message.usage, Date.now(), session.cache?.ttl) ?? session.cache;
  for (const block of msg.message.content) {
    if (block.type === "text") {
      const { text: withReview, status } = extractStatus(block.text);
      const { text, review } = extractReview(withReview);
      if (review) safeUpdate(id, { review });
      if (status) {
        session.status = status;
        safeUpdate(id, { stage: status.stage, remaining: status.remaining });
      }
      if (text.trim()) {
        appendThread(id, { kind: "assistant", text: adoptLocalMedia(text, session.spec.cwd), at: Date.now() });
        safeUpdate(id, { lastLine: firstLine(text) });
      }
    } else if (block.type === "tool_use") {
      const input = (block.input ?? {}) as Record<string, unknown>;
      const summary = summarizeInput(input);
      const action = toolAction(block.name, input);
      if (block.name === "mcp__browser__open_url") session.openedPane = true;
      recordEdit(id, block.name, input);
      const ask = secretAskOf(block.name, input, session.spec.cwd);
      // The diff (when the tool edits a file) and the path it touches, so the thread can show
      // a clickable file link and an inline diff instead of just the tool's raw result. Computed
      // at tool_use time, so Write's diff is against the file on disk. A throw here would still
      // drop the call's preview, so guard: the thread falls back to the raw result.
      const fileEdit = readFileEdit(block.name, input, session.spec.cwd);
      const index = appendThread(id, {
        kind: "tool",
        id: block.id,
        name: block.name,
        summary,
        action,
        at: Date.now(),
        ...(ask && { ask }),
        ...(fileEdit.file && { file: fileEdit.file }),
        ...(fileEdit.edit && { edit: fileEdit.edit }),
      });
      session.toolIndex.set(block.id, index);
      safeUpdate(id, { lastLine: `${shortToolName(block.name)} ${summary}`.trim() });
    }
  }
}

// Keeps the file an edit tool call names on the card, for the shared-files warning (lib/overlap.ts).
// It's recorded when the call is made, so a denied edit counts too; the list lasts the card's life,
// across turns, because the warning is about uncommitted edits in a shared tree and Weft can't
// cheaply tell what got committed. Writes only when the list changes: this runs on every tool call.
function recordEdit(id: string, toolName: string, input: Record<string, unknown>) {
  const path = editedPath(toolName, input);
  if (!path) return;
  const touched = touchFile(getCard(id)?.touchedFiles, path);
  if (touched) safeUpdate(id, { touchedFiles: touched });
}

// The path a tool call names (Read/Edit/Write/MultiEdit/NotebookEdit) and the EditPreview, when
// the call edits a file. Used by the thread to render a clickable file link and an inline diff
// instead of the raw tool result. Paths are returned relative to the card's folder when they
// sit inside it (so the editor opens the same path), absolute when they don't. Wrapped in a
// try/catch: a throw here (a bad path, fs error) drops the preview but never breaks the turn.
const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"]);
function readFileEdit(toolName: string, input: Record<string, unknown>, cwd: string): { file?: string; edit?: ReturnType<typeof editPreview> } {
  if (!FILE_TOOLS.has(toolName)) return {};
  const raw = typeof input.file_path === "string" ? input.file_path : typeof input.notebook_path === "string" ? input.notebook_path : "";
  if (!raw) return {};
  const file = relativize(raw, cwd);
  let edit: ReturnType<typeof editPreview> = undefined;
  try {
    edit = editPreview(toolName, input, cwd);
  } catch {
    // The diff is decoration; a thrown preview (bad path, fs read) must not drop the tool call.
  }
  return { file, ...(edit && { edit }) };
}

// A path relative to `cwd` when it sits inside, absolute otherwise. Empty when neither can be done.
function relativize(given: string, cwd: string): string {
  try {
    const abs = path.resolve(cwd, given);
    const rel = path.relative(cwd, abs);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
    return abs;
  } catch {
    return given;
  }
}

// Tool results fill in the tool items the assistant message added. A card that has used vault secrets gets
// each value swapped for ‹NAME› before the result is stored (lib/secret-run.ts); the model saw it as it was.
function handleToolResults(id: string, session: Session, msg: Extract<SDKMessage, { type: "user" }>): void | Promise<void> {
  const content = msg.message.content;
  if (!Array.isArray(content)) return;
  const pending = content.flatMap((b) =>
    b.type === "tool_result" && session.toolIndex.has(b.tool_use_id)
      ? [{ index: session.toolIndex.get(b.tool_use_id) as number, result: liveToolResult(b.content), isError: Boolean(b.is_error) }]
      : [],
  );
  // A screenshot is saved as WebP first, so its result waits for that; text-only results store right away.
  if (pending.every((r) => !(r.result instanceof Promise))) return storeToolResults(id, pending as ToolEntry[]);
  return Promise.all(pending.map(async (r) => ({ ...r, result: await r.result }))).then((results) => storeToolResults(id, results));
}

type ToolEntry = { index: number; result: ToolResult; isError: boolean };

function storeToolResults(id: string, results: ToolEntry[]): void | Promise<void> {
  return withRedacted(id, results.map((r) => r.result.result), (texts) => {
    results.forEach(({ index, result, isError }, i) => {
      const item = getThread(id)[index];
      if (item?.kind === "tool") replaceThreadItem(id, index, { ...item, ...result, result: texts[i] as string, isError });
    });
  });
}

// An error result Weft acts on instead of settling the turn: the resumed session is gone (the card goes on in a
// fresh one, lib/lost-session.ts), the plan's limit is hit, or the CLI needs a login. Returns whether it did.
function recoverFrom(id: string, session: Session, summary: string): boolean {
  if (isLostSessionError(summary) && resumeLostSession(id, session.spec.sessionId)) return true;
  if (!isNotLoggedInError(summary) && !isRateLimitError(summary)) return false;
  appendThread(id, { kind: "result", text: summary, isError: true, at: Date.now() });
  if (isRateLimitError(summary)) {
    hitRateLimit(id, session.spec.backend, summary);
    // The model that ran out is now known, so the thread moves to the backup model and picks the
    // turn up again there (lib/backend-switch.ts switchToBackup). The card goes on running instead
    // of waiting for the window to reset. Nothing happens when no backup model is set.
    void switchToBackup(id);
  } else hooks.needLogin(id, session.spec.backend, summary);
  return true;
}

// The turn ended: settle the card (column, cost, stats), then archive it or send what was queued.
function handleResult(id: string, session: Session, msg: Extract<SDKMessage, { type: "result" }>) {
  const stopped = session.stopping;
  const parsed = readResult({
    subtype: msg.subtype,
    result: msg.subtype === "success" ? msg.result : undefined,
    isError: msg.is_error,
    stopped,
  });
  const { summary, isError } = parsed;
  // A message sent mid-turn that this turn ended without taking in goes next, as the CLI's own turn.
  const goesOn = waitingInCli(session, msg.user_message_uuids);
  session.busy = goesOn;
  session.stopping = false;

  if (isError && recoverFrom(id, session, summary)) return;

  const status = parsed.status ?? session.status;
  // Whether this turn was the card's wrap-up, not whether the card is wrapping up: a Done move
  // landing on a busy card marks the card, but the turn already running is an ordinary one.
  const wrapUp = session.wrapUp === true;
  const cost = turnCost(getCard(id)?.costUsd ?? 0, msg.total_cost_usd, session.costBase);
  session.costBase = cost.base;
  appendThread(id, { kind: "result", text: summary, costUsd: cost.costUsd, isError, at: Date.now() });
  safeUpdate(id, {
    ...sessionFrom(msg, isError),
    column: goesOn ? "running" : columnAfterTurn(stopped, isError, status, wrapUp),
    pending: null,
    costUsd: cost.costUsd,
    turns: (getCard(id)?.turns ?? 0) + 1,
    lastActivity: Date.now(),
    lastWeftTurn: Date.now(),
    stats: turnStats(id, session, msg.modelUsage),
    lastLine: firstLine(summary) || "Done",
    error: isError ? summary : undefined,
    ...(status ? { stage: status.stage, remaining: status.remaining } : {}),
  });
  if (goesOn) {
    goOn(session);
    return;
  }
  // Calls auto mode's classifier denied itself, asked about on the card now that the turn is over.
  const asked = askAboutDenials(id, session, msg.permission_denials, columnAfterTurn(stopped, isError, status, wrapUp), !stopped);
  scheduleIdle(session);
  if (!session.spec.copilot) showAfter(id, session, { reply: summary, isError, stopped });
  finishResult(id, status, stopped, isError, wrapUp, asked);
}

// A resume the CLI refused (transcript gone or too large) fails before any turn, under a new id it never writes:
// taking that id would lose the real one, and the lost-session check (lib/lost-session.ts) would no longer match.
function sessionFrom(msg: Extract<SDKMessage, { type: "result" }>, isError: boolean): { sessionId?: string } {
  return isError && msg.num_turns === 0 ? {} : { sessionId: msg.session_id };
}

// The CLI runs the message it still holds as a turn of its own, so the card stays running and nothing queued
// goes out until that turn's result.
function goOn(session: Session) {
  session.status = undefined;
  session.openedPane = false;
  session.wrapUp = false;
  session.turnSeq = (session.turnSeq ?? 0) + 1;
}

// A wrap-up (/done, or a move to Done's automations) that has run its last turn files the card away.
// A stopped or failed one isn't, nor one that ended in Review (it couldn't commit, push or deploy, and
// says what's left); a starred card stays on the board too.
// A wrap-up that ends in Needs you is still a finished wrap-up: the work is done, so the card goes to
// Done and is archived rather than parked in Needs you waiting for a reply nobody asked for.
function settleWrapUp(id: string, status: BoardStatus | undefined, failed: boolean) {
  if (!archiveAfter.has(id) || !(failed || !queued.has(id))) return;
  archiveAfter.delete(id);
  const unfinished = failed || status?.column === "review";
  // An isolated card lands its branch first; landing files it away, or hands it back (lib/worktree-done.ts).
  if (!unfinished && getCard(id)?.worktree) {
    hooks.land(id);
    return;
  }
  safeUpdate(id, unfinished ? { wrappingUp: false } : { column: "done", archived: !getCard(id)?.starred, wrappingUp: false });
}

// The bookkeeping around archiveAfter and the queued-turn handoff.
// asked: the turn ended with a prompt about a classifier denial, which waits for you like a Needs you status does.
function finishResult(id: string, status: BoardStatus | undefined, stopped: boolean, isError: boolean, wrapUp: boolean, asked = false) {
  const failed = stopped || isError;
  settleWrapUp(id, status, failed);
  // Whether the wrap-up succeeded, failed, or was stopped: the /weft:done turn is over, so the model's
  // and effort's snapshot (if a Done move applied one) is no longer needed. Safe on a card that was
  // moved to Done by a /weft:done the user typed themselves, where there's no snapshot.
  restoreDoneOverride(id);
  if (queued.has(id)) {
    if (failed) queued.delete(id);
    // Once the drive loop has handled this result, so the next turn starts on a settled card. A turn
    // that ends needing you waits for your reply before the next queued message goes out — unless it
    // was a wrap-up, which is over whether it asks for anything or not.
    else if ((status?.column !== "needs_you" && !asked) || wrapUp) setTimeout(() => hooks.sendQueued(id), 0);
  }
  // A message that came mid-turn goes whatever the turn's end: it's yours (or a page's on your click).
  // Queued automations go first when they're running on; it then waits for the last of them.
  if (!queued.has(id)) setTimeout(() => hooks.sendHeld(id), 0);
}

// A teammate's update page for the pane when the turn showed nothing (lib/show.ts), written in the background.
function showAfter(id: string, session: Session, turn: { reply: string; isError: boolean; stopped: boolean }) {
  const ask = getThread(id).findLast((item) => item.kind === "user");
  const seq = session.turnSeq;
  const turnInfo = { ...turn, ask: ask?.kind === "user" ? ask.text : "", openedPane: Boolean(session.openedPane) };
  showAfterTurn(id, turnInfo, () => session.turnSeq === seq && !session.busy).catch(() => {});
}

// The plan's 5-hour and weekly usage, asked of the CLI so it shows before any rate-limit event.
//
// The per-model weekly caps come with it (the SDK's seven_day_opus, seven_day_sonnet and
// model_scoped rows). Those are the MODEL's own limits, not the plan's, so they go to the
// per-model store (lib/model-limit.ts) — where they gate that model alone — and not to the plan
// window, which would gate every model on the account and leave the user with no way out but
// waiting for the reset (lib/limit-kind.ts).
async function refreshLimits(id: string, session: Session) {
  try {
    const usage = await session.query?.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
    const limits = usage?.rate_limits;
    if (!limits) return;
    updateLimits(id, session.spec.backend, { fiveHour: usageWindow(limits.five_hour), sevenDay: usageWindow(limits.seven_day) });
    recordModelCaps(getCard(id)?.model, limits);
  } catch {}
}

// A sample in the history behind the strip and its chart (lib/limit-history.ts), under the CLI whose
// session reported it, and the card's latest windows while the card is still on that CLI: a reading
// that lands after "Run on …" switched it belongs to the old CLI's plan, not the new one's.
function updateLimits(id: string, backend: Backend, patch: Pick<CardStats, "fiveHour" | "sevenDay">) {
  if (getCard(id)?.backend === backend) updateStats(id, patch);
  recordLimits(backend, patch);
}

function updateStats(id: string, patch: Partial<CardStats>) {
  safeUpdate(id, { stats: { ...getCard(id)?.stats, ...patch } });
}

// The status strip's numbers after a turn: model, context fill, tokens, and the folder's changed lines.
function turnStats(id: string, session: Session, modelUsage: Record<string, ModelUsage>): CardStats {
  return {
    ...getCard(id)?.stats,
    ...modelStats(modelUsage, session.cache?.tokens),
    ...(session.cache && { cache: session.cache }),
    ...changedLines(session.spec.cwd),
    branch: gitBranch(session.spec.cwd),
  };
}

// Every function here, for the session fingerprint (BUILD in lib/runner-session.ts): changing any of them
// replaces idle sessions started by the old code.
export const TURN_CODE = [handle, handleSystem, handleRateLimit, handleSuggestion, handleAssistant, recordEdit, handleToolResults, storeToolResults, handleResult, finishResult, showAfter, refreshLimits, updateStats, turnStats];
