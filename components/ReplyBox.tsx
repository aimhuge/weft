"use client";

import { useRef, useState, type ReactNode } from "react";
import { bangCommand } from "@/lib/bang";
import { type PlanResets } from "@/lib/schedule";
import { replyPlaceholder } from "@/lib/reply-placeholder";
import { useReplyDraft } from "@/lib/use-reply-draft";
import { useReplyKeys } from "@/lib/use-reply-keys";
import { useReplySchedule } from "@/lib/use-reply-schedule";
import { useReplyContinue } from "@/lib/use-reply-continue";
import { useReplyQueue } from "@/lib/use-reply-queue";
import { useNow } from "@/lib/use-now";
import { useThreadGate } from "@/lib/use-start-gate";
import { replyBoxMode, type ReplyAction } from "@/lib/reply-mode";
import type { Backend, CacheState, LimitWindow, ScheduledMessage } from "@/lib/types";
import Composer, { type ComposerHandle } from "./Composer";
import QuestionForm, { type QuestionFormHandle, type QuestionProps } from "./QuestionForm";
import ReplyBoxActions from "./ReplyBoxActions";
import { ModeChip, modeBorder } from "./ReplyModeChip";
import { ReplyQueue } from "./ReplyQueue";
import { track } from "@/lib/analytics";

// Board threads can take a message to send at a set time; the copilot can't, so it leaves this out.
// resets are the plan's next 5-hour and weekly resets, the default times on a Claude thread.
type SendLater = { backend: Backend; resets: PlanResets; scheduled: ScheduledMessage[] };

// Your last sent message, for ↑ to edit (board threads only). canRewind: Enter replaces it and its
// turn; otherwise the edit goes out as a new message. fileEdits: what its turn changed on disk, which stays.
type EditLast = { text: string; canRewind: boolean; fileEdits: number; onEdit: (text: string) => Promise<void> };

// The prompt cache gone cold, and the way around re-sending the thread (lib/splice.ts): onFresh sends the message
// in a new session of this card, started from a brief of the thread.
export type StaleProps = { cache: CacheState; onFresh: (message: string) => Promise<void> };

// A thread's reply box: the same composer as a new thread (Markdown, pasted images and videos,
// dictation), sized for a reply. Enter sends; Shift+Enter starts a new line. A message starting with "!"
// is a shell command instead (onShell): it runs in the card's folder, even mid-turn, and the box turns amber.
export default function ReplyBox({
  cardId,
  cwd,
  live,
  midTurn = false,
  placeholder,
  suggestion,
  sendLater,
  status,
  stale,
  cutOff = false,
  noPriorContext: noPriorContextProp = false,
  fiveHour,
  backend,
  model,
  autoFocus,
  editLast,
  onEditing,
  question,
  onSend,
  onShell,
  onStop,
}: {
  cardId: string;
  cwd: string;
  live: boolean;
  // A live turn here takes a message in after its next tool call, so Enter sends instead of queueing.
  midTurn?: boolean;
  placeholder: string;
  suggestion?: string;
  sendLater?: SendLater;
  status?: ReactNode;
  stale?: StaleProps;
  // The last turn stopped short (lib/reply-mode.ts turnCutOff), so Continue is offered.
  cutOff?: boolean;
  // No prior assistant context: the model/CLI was just switched, or the card was never started.
  // When true, the reply box defaults to Send fresh and Continue is hidden.
  noPriorContext?: boolean;
  // The plan's 5-hour window on this thread; when it's used up, Enter schedules for its reset.
  fiveHour?: LimitWindow;
  // The thread's CLI and model, so the reply box can ask the shared limit stores (lib/limit-reset.ts)
  // about the model's own cap and the CLI's weekly window, not just this thread's snapshot.
  backend?: Backend;
  model?: string;
  autoFocus?: boolean;
  editLast?: EditLast;
  onEditing?: (editing: boolean) => void;
  question?: QuestionProps & { key: string };
  onSend: (text: string) => Promise<void>;
  onShell?: (command: string) => Promise<void>;
  onStop: () => Promise<void>;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Started ‘…’" once the box handed its work to a new card.
  const [note, setNote] = useState<string | null>(null);
  const [laterOpen, setLaterOpen] = useState(false);
  // ↑ pulled your last sent message back into the box; Enter replaces it, Escape lets it be.
  const [editing, setEditingState] = useState(false);
  const now = useNow();
  const composer = useRef<ComposerHandle>(null);
  const form = useRef<QuestionFormHandle>(null);

  const setErrorWrap = (err: unknown) => setError(err instanceof Error ? err.message : String(err));
  const clearError = () => setError(null);
  const captureReply = () => {
    track("thread_reply_sent", { reply_type: "message" });
  };
  const { initial, save: saveDraft, shell, empty } = useReplyDraft(cardId, onShell, clearError);

  // Messages written while the thread was working; they go out together once the turn ends.
  const queued = useReplyQueue({ live, busy: sending, onSend, onStop, onSent: captureReply, onError: setErrorWrap });
  const { queue, paused, setQueue, setPaused } = queued;
  const busy = sending || queued.sending;

  // What's in the box, or null once it has shown why the box can't be read.
  function readBox() {
    try {
      return composer.current?.read() ?? "";
    } catch (err) {
      setErrorWrap(err);
      return null;
    }
  }

  function setEditing(on: boolean) {
    setEditingState(on);
    onEditing?.(on);
  }

  // A send that failed: its text goes back in the box, unless you've started another message there since.
  function putBack(text: string) {
    if (!composer.current?.isEmpty()) return;
    composer.current.write(text);
    saveDraft(text, true);
  }

  function cancelEdit() {
    composer.current?.clear();
    saveDraft("", true);
    setEditing(false);
  }

  // Enter on a message ↑ pulled back: it replaces the one you sent. An emptied box just cancels.
  async function sendEdit(text: string) {
    if (!text || !editLast) {
      cancelEdit();
      return;
    }
    // The box empties and the edit is drawn at once; a refusal brings the edit back to finish.
    setSending(true);
    cancelEdit();
    try {
      await editLast.onEdit(text);
    } catch (err) {
      putBack(text);
      setEditing(true);
      setErrorWrap(err);
    } finally {
      setSending(false);
    }
  }

  // Runs the "!" command in the box; it doesn't wait for a running turn.
  async function runShell() {
    const command = bangCommand(composer.current?.readText() ?? "") ?? "";
    if (!command || !onShell) {
      setError("Write a command after the !.");
      return;
    }
    setSending(true);
    try {
      await onShell(command);
      saveDraft("", true);
      composer.current?.clear();
    } catch (err) {
      setErrorWrap(err);
    } finally {
      setSending(false);
    }
  }

  // Enter on an empty box lets a held queue go; Send now with an empty box sends what's queued instead.
  function emptyBox(now: boolean) {
    if (paused && queue.length > 0) queued.resume();
    else if (now && queue.length > 0) void queued.sendNow();
    else setError("Write a message first.");
  }

  // midTurn: Send on a live Claude Code or puku turn, which takes it in after its next tool call (lib/runner-steer.ts).
  async function submit(now = false, midTurn = false) {
    if (busy) return;
    if (shell && !editing) return runShell();
    const text = readBox();
    if (text === null) return;
    if (editing) return sendEdit(text);
    if (!text) {
      emptyBox(now);
      return;
    }
    if (live && !now && !midTurn) {
      queued.add(text);
      saveDraft("", true);
      composer.current?.clear();
      return;
    }
    // The box empties now and the thread draws the message (lib/use-pending-sends.ts), so a send never looks
    // ignored; a refusal puts the text back.
    setSending(true);
    saveDraft("", true);
    composer.current?.clear();
    try {
      // Send now: interrupt the running turn first, then the message goes out as the next one.
      if (live && now) await onStop();
      await onSend(text);
      captureReply();
      queued.resume();
    } catch (err) {
      putBack(text);
      setErrorWrap(err);
    } finally {
      setSending(false);
    }
  }

  // Enter or Send: answers a waiting question (a "!" command still runs), else sends.
  function send(now = false, midTurn = false) {
    if (question && form.current && !shell) form.current.enter();
    else void submit(now, midTurn);
  }

  // Send fresh: the message (what's typed, or `text` from a button) goes to a new session of this card that starts
  // from a brief of the thread (lib/splice.ts). A button's text leaves the draft alone.
  async function sendFresh(text?: string) {
    if (!stale || busy) return;
    const message = text ?? composer.current?.readText() ?? "";
    if (!message.trim()) {
      setError("Write a message first.");
      return;
    }
    setSending(true);
    if (text === undefined) {
      composer.current?.clear();
      saveDraft("", true);
    }
    try {
      await stale.onFresh(message);
      captureReply();
    } catch (err) {
      if (text === undefined) putBack(message);
      setErrorWrap(err);
    } finally {
      setSending(false);
    }
  }

  const { scheduleAt, unschedule, takeBackScheduled, scheduled } = useReplySchedule(cardId, composer, saveDraft, setErrorWrap, sendLater?.scheduled);
  const { onKeyDownCapture, onKeyDown } = useReplyKeys({
    composer,
    form,
    question,
    live,
    suggestion,
    editing,
    editLast,
    queue,
    sendLater,
    setLaterOpen,
    cancelEdit,
    setEditing,
    setQueue,
    setPaused,
    onStop,
    setError: setErrorWrap,
  });

  // Send fresh is offered to Claude and puku (stale is set there). Codex never sets it; for codex the
  // new session in the same card isn't supported (lib/splice.ts sendFresh refuses codex), so the primary
  // falls back to plain Send with the no-prior-context chip and Continue is hidden.
  const canFresh = Boolean(stale);
  // The shared limit stores know more than this thread's own snapshot: the model's own cap and the
  // CLI's weekly window (lib/limit-reset.ts). Where the thread can be scheduled, they answer.
  const gate = useThreadGate(fiveHour, sendLater?.resets.fiveHour, backend ?? "claude", model);
  const { view, resetAt } = replyBoxMode({
    live,
    midTurn,
    question: Boolean(question),
    shell,
    editing,
    editLast,
    empty,
    cwd,
    cache: stale?.cache,
    fiveHour,
    sendLater: sendLater && { planReset: sendLater.resets.fiveHour },
    limitResetAt: gate?.at,
    cutOff,
    canFresh,
    // No prior assistant context when the card has no live session: a model/CLI was just switched
    // (lib/backend-switch.ts clears sessionId), or the card was never started. A long-running card
    // whose cache lapsed but whose session is still alive is NOT no-prior-context: Continue still
    // makes sense there, and the chip stays "Cache cold · 184k".
    noPriorContext: noPriorContextProp,
    now,
  });

  // Continue: the literal word "continue" through the same onSend path as a typed message. `disabled`
  // is true when the primary is Send fresh (no prior assistant context): there's nothing to continue,
  // so the ▾ menu hides Continue and ⌘⇧↵ is a no-op. When the primary is Continue itself, ⌘⇧↵ still
  // works (it's the same code path that the primary button uses).
  const { sendContinue } = useReplyContinue({
    live,
    question: Boolean(question),
    shell,
    editing,
    disabled: view.primary.action === "fresh",
    onSend: async (text) => {
      await onSend(text);
      captureReply();
    },
    setError: setErrorWrap,
  });

  // What the primary or a menu item does (lib/reply-mode.ts names them).
  function onAction(action: ReplyAction) {
    setNote(null);
    if (action === "done") {
      // Cold, Done goes fresh too: a wrap-up needs the brief and the diff, not the whole thread.
      if (view.primary.action === "fresh") void sendFresh("/weft:done");
      else void onSend("/weft:done").then(captureReply, setErrorWrap);
    } else if (action === "fresh") void sendFresh();
    else if (action === "continue") sendContinue();
    else if (action === "later") setLaterOpen(true);
    else if (action === "schedule") {
      if (resetAt) void scheduleAt(resetAt);
    } else send(action === "sendNow", action === "steer");
  }

  return (
    <div className="border-t border-line p-3" data-human-only onKeyDownCapture={onKeyDownCapture} onKeyDown={onKeyDown}>
      {question && <QuestionForm {...question} key={question.key} ref={form} cardId={cardId} composer={composer} />}
      <ReplyQueue
        scheduled={scheduled}
        queue={queue}
        paused={paused}
        live={live}
        sending={busy}
        now={now}
        onTakeBack={takeBackScheduled}
        onUnschedule={unschedule}
        onSendNow={(i) => void queued.sendNow(i)}
        onRemove={queued.remove}
      />
      <Composer
        ref={composer}
        variant="reply"
        cwd={cwd}
        dropTarget={cardId}
        initial={initial}
        autoFocus={autoFocus}
        placeholder={replyPlaceholder(live, suggestion, placeholder, Boolean(question))}
        onSubmit={() => onAction(view.primary.action)}
        onChange={saveDraft}
        sizeClass="min-h-[44px] max-h-[40vh]"
        className={modeBorder(view.tone)}
        header={view.chip && <ModeChip tone={view.tone} text={view.chip} />}
        actions={
          <ReplyBoxActions
            view={view}
            live={live}
            sending={busy}
            sendLater={sendLater ? { backend: sendLater.backend, resets: sendLater.resets } : undefined}
            laterOpen={laterOpen}
            setLaterOpen={setLaterOpen}
            now={now}
            onPick={(at) => void scheduleAt(at)}
            onAction={onAction}
            onStop={onStop}
            onStopError={setErrorWrap}
          />
        }
      />
      {status && <div className="mt-1.5 px-1">{status}</div>}
      {note && <p className="mt-1.5 text-[12px] text-muted">{note}</p>}
      {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
