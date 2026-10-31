"use client";

// The ReplyBox's scheduled-message side: server schedule/unschedule and the "take it back to edit"
// handoff. The composer ref and the draft saver are passed in so the box is the only state owner.
// Each change draws at once: a scheduled message's row shows (and the box empties) before the server answers, an
// X'd one's row leaves, so a second click can't schedule it twice. A refusal undoes the drawing.
import { useCallback, useState, type RefObject } from "react";
import { api } from "@/lib/client";
import { canSendNow } from "@/lib/schedule";
import { STOP_SETTLE_MS } from "@/lib/optimistic-cards";
import type { ComposerHandle } from "@/lib/composer-handle";
import type { ScheduledMessage } from "@/lib/types";

export interface UseReplySchedule {
  // The "Send later" picker picked a time: hand the message to the server.
  scheduleAt: (at: number) => Promise<void>;
  // The user clicked the X on a queued scheduled message: drop it on the server.
  unschedule: (messageId: string) => void;
  // The user clicked a scheduled message to edit it: put it in the empty box and stop scheduling it.
  takeBackScheduled: (m: ScheduledMessage) => void;
  // Send now on a held row: drop it, stop the running turn, send it as the next one.
  sendNow: (m: ScheduledMessage) => Promise<void>;
  // A Send now is on its way, so the rows' Send now buttons wait.
  sending: boolean;
  // The card's scheduled messages as drawn: the server's, less the ones being dropped, plus the ones being added.
  scheduled: ScheduledMessage[];
}

// How Send now reaches the thread: the reply box's own stop and send (components/ReplyBox.tsx).
export interface ScheduledSendNow {
  live: boolean;
  onStop: () => Promise<void>;
  onSend: (text: string) => Promise<void>;
  onSent: () => void;
}

let lastKey = 0;
// A row being added is the server's once the server's list has a message with its text and time.
const same = (a: ScheduledMessage, b: ScheduledMessage) => a.at === b.at && a.text.trim() === b.text.trim();

export function useReplySchedule(
  cardId: string,
  composer: RefObject<ComposerHandle | null>,
  saveDraft: (markdown: string, now?: boolean) => void,
  setError: (err: unknown) => void,
  server: ScheduledMessage[] = [],
  thread?: ScheduledSendNow,
): UseReplySchedule {
  const [adding, setAdding] = useState<ScheduledMessage[]>([]);
  const [dropping, setDropping] = useState<ReadonlySet<string>>(new Set());
  const [sending, setSending] = useState(false);
  const undrop = useCallback((messageId: string) => {
    setDropping((prev) => {
      const next = new Set(prev);
      next.delete(messageId);
      return next;
    });
  }, []);

  const drop = useCallback(
    (messageId: string) => {
      // A row still on its way to the server has no id there yet.
      if (messageId.startsWith("pending-")) return;
      setDropping((prev) => new Set(prev).add(messageId));
      api.unschedule(cardId, messageId).catch((err: unknown) => {
        undrop(messageId);
        setError(err);
      });
    },
    [cardId, setError, undrop],
  );

  // Unscheduled first, so the turn the stop ends can't send it too (lib/runner.ts sendHeld); a send that fails after
  // that puts it in the box, where it isn't lost.
  const sendNow = useCallback(
    async (m: ScheduledMessage) => {
      if (!thread || sending || !canSendNow(m)) return;
      setSending(true);
      setDropping((prev) => new Set(prev).add(m.id));
      try {
        await api.unschedule(cardId, m.id);
      } catch (err) {
        undrop(m.id);
        setError(err);
        setSending(false);
        return;
      }
      try {
        if (thread.live) await thread.onStop();
        await thread.onSend(m.text);
        thread.onSent();
      } catch (err) {
        if (composer.current?.isEmpty()) composer.current.write(m.text);
        setError(err);
      } finally {
        setSending(false);
      }
    },
    [cardId, composer, sending, setError, thread, undrop],
  );

  const takeBackScheduled = useCallback(
    (m: ScheduledMessage) => {
      if (!composer.current?.isEmpty()) {
        setError("Clear the box first to edit a scheduled message.");
        return;
      }
      composer.current.write(m.text);
      drop(m.id);
    },
    [composer, drop, setError],
  );

  const scheduleAt = useCallback(
    async (at: number) => {
      let text: string;
      try {
        text = composer.current?.read() ?? "";
      } catch (err) {
        setError(err);
        return;
      }
      if (!text) {
        setError("Write a message first.");
        composer.current?.focus();
        return;
      }
      const row: ScheduledMessage = { id: `pending-${++lastKey}`, text, at };
      const unadd = () => setAdding((list) => list.filter((m) => m !== row));
      setAdding((list) => [...list, row]);
      saveDraft("", true);
      composer.current?.clear();
      try {
        await api.schedule(cardId, text, at);
        setTimeout(unadd, STOP_SETTLE_MS);
      } catch (err) {
        unadd();
        if (composer.current?.isEmpty()) {
          composer.current.write(text);
          saveDraft(text, true);
        }
        setError(err);
      }
    },
    [cardId, composer, saveDraft, setError],
  );

  const scheduled = [...server.filter((m) => !dropping.has(m.id)), ...adding.filter((a) => !server.some((m) => same(m, a)))];
  return { scheduleAt, unschedule: drop, takeBackScheduled, sendNow, sending, scheduled };
}
