"use client";

// The ReplyBox's keydown handling. Lives outside the component so the JSX is just layout: the box
// has one capture handler (question keys, Alt+Enter, Tab, Escape, ↑) and one bubble handler (Ctrl+C
// while a turn runs).
import { useCallback, type KeyboardEvent, type RefObject } from "react";
import type { ComposerHandle } from "@/lib/composer-handle";
import type { QuestionFormHandle, QuestionProps } from "@/lib/question-form-types";
import type { Backend, ScheduledMessage } from "@/lib/types";
import type { PlanResets } from "@/lib/schedule";

export interface UseReplyKeysOptions {
  composer: RefObject<ComposerHandle | null>;
  form: RefObject<QuestionFormHandle | null>;
  question: (QuestionProps & { key: string }) | undefined;
  live: boolean;
  suggestion: string | undefined;
  editing: boolean;
  editLast: { text: string } | undefined;
  queue: string[];
  sendLater: { backend: Backend; resets: PlanResets; scheduled: ScheduledMessage[] } | undefined;
  setLaterOpen: (open: boolean) => void;
  cancelEdit: () => void;
  setEditing: (on: boolean) => void;
  setQueue: React.Dispatch<React.SetStateAction<string[]>>;
  setPaused: (paused: boolean) => void;
  onStop: () => Promise<void>;
  setError: (err: unknown) => void;
}

export interface UseReplyKeys {
  onKeyDownCapture: (e: KeyboardEvent) => void;
  onKeyDown: (e: KeyboardEvent) => void;
}

// Tab in an empty box takes the suggested next message, to edit or send. Returns true if it did.
function takeSuggestion(
  e: KeyboardEvent,
  composer: RefObject<ComposerHandle | null>,
  suggestion: string | undefined,
  live: boolean,
): boolean {
  const plainTab = e.key === "Tab" && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey;
  if (!plainTab || !suggestion || live || !composer.current?.isEmpty()) return false;
  e.preventDefault();
  e.stopPropagation();
  composer.current.write(suggestion);
  return true;
}

// Alt+Enter with no other modifier.
function isAltEnter(e: KeyboardEvent): boolean {
  return e.key === "Enter" && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey;
}

// Up in an empty box pulls the last queued message back to edit (the queue holds meanwhile), or,
// with nothing queued, the last message you sent.
function pullBack(
  e: KeyboardEvent,
  o: Pick<UseReplyKeysOptions, "composer" | "queue" | "editLast" | "editing" | "setQueue" | "setPaused" | "setEditing">,
): void {
  if (e.key !== "ArrowUp" || !o.composer.current?.isEmpty()) return;
  const last = o.queue.at(-1);
  const text = last ?? (o.editLast && !o.editing ? o.editLast.text : undefined);
  if (text === undefined) return;
  e.preventDefault();
  e.stopPropagation();
  o.composer.current.write(text);
  if (last !== undefined) {
    o.setQueue((q) => q.slice(0, -1));
    o.setPaused(true);
  } else o.setEditing(true);
}

export function useReplyKeys({
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
  setError,
}: UseReplyKeysOptions): UseReplyKeys {
  const onKeyDownCapture = useCallback(
    (e: KeyboardEvent) => {
      // While a question waits, the arrows, numbers and space in an empty box move through its options.
      if (question && form.current?.key(e, composer.current?.isEmpty() ?? true)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Alt+Enter opens Send later with the default time focused, so a second Enter schedules it.
      if (sendLater && isAltEnter(e)) {
        e.preventDefault();
        e.stopPropagation();
        setLaterOpen(true);
        return;
      }
      if (takeSuggestion(e, composer, suggestion, live)) return;
      // Escape drops an edit and leaves the message as it was sent (before it would close the thread).
      if (editing && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelEdit();
        return;
      }
      pullBack(e, { composer, queue, editLast, editing, setQueue, setPaused, setEditing });
    },
    [composer, form, question, live, suggestion, editing, editLast, queue, sendLater, setLaterOpen, cancelEdit, setEditing, setQueue, setPaused],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ctrl+C stops the running turn, unless text is selected (then it's a copy).
      if (live && e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
        e.preventDefault();
        void onStop().catch((err: unknown) => setError(err));
      }
    },
    [live, onStop, setError],
  );

  return { onKeyDownCapture, onKeyDown };
}
