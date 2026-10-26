"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { isLive } from "@/lib/format";
import { isPukuCapError } from "@/lib/billing/upgrade";
import { openUpgrade } from "@/lib/use-upgrade";
import { onScrollToTurn, pulse, reportTopTurn, topmostTurn, turnRow, PULSE_MS } from "@/lib/show-events";
import type { PlanResets } from "@/lib/schedule";
import { THREAD_PAGE_SIZE } from "@/lib/cloud-sync-types";
import { mergeOlderPage, pageThread, type ThreadPage } from "@/lib/thread-page";
import { useThreadTransport, type ThreadTransport } from "@/lib/thread-transport";
import type { Card, QuestionReply, ThreadItem } from "@/lib/types";
import { usePendingSends } from "@/lib/use-pending-sends";
import { useEditLast } from "@/lib/use-edit-last";
import { guarded } from "./guarded";
import { useFileIndex } from "@/lib/use-file-index";
import { FileIndexContext, FileLinkContext } from "./file-link-context";
import { Spinner } from "./Icon";
import { PermissionRequest, ThreadReply } from "./ThreadFooter";
import { ThreadEntries, groupThread } from "./ThreadItems";
import FirstMessageErrorBanner from "./FirstMessageErrorBanner";
import YouFirst from "./YouFirst";
import { firstMessageFailed } from "@/lib/first-message-failed";

// Loaded in its own CrashGuard (components/guarded.tsx), so a broken strip leaves the thread and its reply box.
const TaskStrip = guarded(() => import("./TaskStrip"), { what: "subagents", inline: true });

// A pending question, for the reply box, whose composer is where you type your own answer or a note.
function questionFor(card: Card, onAnswer: (allow: boolean, answers?: Record<string, string>, reply?: QuestionReply) => unknown, transport: ThreadTransport) {
  const pending = card.pending;
  const { grantFolder } = transport;
  if (!pending?.questions) return undefined;
  return {
    key: pending.id,
    questions: pending.questions,
    readScope: pending.readScope,
    previewUrl: pending.previewUrl,
    onAnswer: (answers: Record<string, string>, annotations: NonNullable<QuestionReply["annotations"]>) =>
      onAnswer(true, answers, Object.keys(annotations).length ? { annotations } : undefined),
    onDecline: (chat: string) => onAnswer(false, undefined, chat.trim() ? { chat } : undefined),
    // Persist the read scope (the folder guard reads it live); the form answers the question itself.
    onReadScope: grantFolder && ((path: string) => void grantFolder(card.id, path, "card").catch(() => {})),
  };
}

// A thread's messages, its pending permission request, and the reply box.
// The parent supplies a flex column for it to fill.
export default function ThreadView({
  card,
  items,
  streaming,
  onSend,
  onAnswer,
  empty,
  placeholder = "Reply to continue this thread",
  footer,
  replaceReply = false,
  readOnly = false,
  scheduling,
  onOpenSettings,
  onDeleted,
}: {
  card: Card;
  // The full thread snapshot from the parent; used as the seed on first connect and on reconnect,
  // so the page can recover when the live stream is between events.
  items: ThreadItem[];
  streaming: string;
  onSend: (text: string) => Promise<void>;
  // reply: a question's notes, or what to talk over instead. A rejected promise lets the user answer again.
  onAnswer: (allow: boolean, answers?: Record<string, string>, reply?: QuestionReply) => unknown;
  empty?: ReactNode;
  placeholder?: string;
  // Shown above the reply box, or in its place with replaceReply.
  footer?: ReactNode;
  replaceReply?: boolean;
  // Nothing can be sent from here (weft.zip, a teammate's card): no reply box and no answers, just the status.
  readOnly?: boolean;
  // Given on board threads, so the reply box offers Send later; resets are the plan's next 5-hour and weekly resets.
  scheduling?: { resets: PlanResets };
  // Open the Settings dialog (Board wires this to its own settings opener). The first-message-error banner
  // uses it for "Pick a backup model"; the web board's read-only transport leaves it undefined and the
  // banner hides that escape (components/FirstMessageErrorBanner.tsx).
  onOpenSettings?: () => void;
  // After Delete, the parent (Board) closes the thread. Optional; without it, the banner still deletes
  // the card but the open thread stays mounted with the now-deleted id.
  onDeleted?: () => void;
}) {
  // The request already answered here, so a second click can't answer it (or the next one) again.
  const [answeredId, setAnsweredId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const live = isLive(card);
  // The page is the source of truth for what's drawn. It starts as the parent's `items` snapshot
  // (newest THREAD_PAGE_SIZE) so first paint isn't blank; the server fetch then takes over.
  const [page, setPage] = useState<ThreadPage>(() => pageThread(items, { limit: THREAD_PAGE_SIZE }));
  const [loadingOlder, setLoadingOlder] = useState(false);
  const answered = answeredId !== null && answeredId === card.pending?.id;
  const transport = useThreadTransport();
  // The folder's files, re-read as the thread grows, so the names it mentions link to the editor column.
  const fileIndex = useFileIndex(card.id, card.cwd, transport.listFiles, page.total);
  // Your sends, drawn in the thread the moment you press Enter until the server's copy lands (lib/pending-sends.ts).
  const sends = usePendingSends(card.id, page);
  const { editLast, editFrom, onEditing } = useEditLast(card, page.items, transport.editLast, () => (stick.current = true), (text, call, after) => sends.track(text, call, page.start + after));
  const question = questionFor(card, onAnswer, transport);
  const showReply = !readOnly && (!replaceReply || Boolean(question));

  // Fetch one page of the thread, newest (`before` omitted) or older (with `before=start`), from the
  // transport (lib/thread-transport.ts). A page it can't read leaves the user on what's loaded.
  const loadPage = useCallback(async (before?: number) => {
    const data = await transport.loadPage(card.id, before);
    if (data) setPage((prev) => (before === undefined ? data : mergeOlderPage(prev, data)));
  }, [card.id, transport]);

  // On card change, fetch the newest page. The seed above covers the first paint; a microtask keeps
  // the setState out of the effect's synchronous render path (eslint: react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!card.id) return;
    queueMicrotask(() => void loadPage().catch(() => {}));
  }, [card.id, loadPage]);

  // Live changes land in the loaded window; a reconnect re-pulls the newest page to catch up on any it missed.
  transport.useLive(card.id, setPage, () => {
    loadPage().catch(() => {});
  });

  // Follow new output unless the user has scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [page.items, streaming, card.pending]);

  // Images load after the text and push it up; keep following the bottom while they do.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const follow = () => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    };
    el.addEventListener("load", follow, true);
    return () => el.removeEventListener("load", follow, true);
  }, []);

  // The show rail (components/ShowRail.tsx): a clicked mini scrolls here, and a scroll of our own
  // tells the rail which turn is now on top (and whether we're at the end), at most once per 80 ms; the pane
  // follows it to that turn's page. A rail-driven scroll doesn't echo back.
  const railScroll = useRef(0);
  const reportTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastTop = useRef<string>(undefined);
  useEffect(() => {
    const off = onScrollToTurn((id) => {
      const el = scroller.current;
      const row = el && turnRow(el, id);
      if (!row) return;
      stick.current = false;
      lastTop.current = id;
      railScroll.current = Date.now() + PULSE_MS + 200;
      row.scrollIntoView({ block: "start", behavior: "smooth" });
      pulse(row);
    });
    return () => {
      off();
      clearTimeout(reportTimer.current);
    };
  }, []);

  function reportTop(el: HTMLElement) {
    clearTimeout(reportTimer.current);
    reportTimer.current = setTimeout(() => {
      if (Date.now() < railScroll.current) return;
      const id = topmostTurn(el);
      const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      const key = `${id}${bottom ? "↓" : ""}`;
      if (!id || key === lastTop.current) return;
      lastTop.current = key;
      reportTopTurn(id, bottom);
    }, 80);
  }

  // The user scrolled near the top of the loaded window: ask the server for the page that ends at
  // `start`. If the request returns more items, prepend them and adjust scrollTop by the height
  // they added, so the row the user was looking at stays put.
  async function loadOlder(before: number) {
    if (loadingOlder || before <= 0) return;
    setLoadingOlder(true);
    const el = scroller.current;
    const beforeHeight = el?.scrollHeight ?? 0;
    try {
      await loadPage(before);
    } finally {
      setLoadingOlder(false);
      // After the prepend, scrollTop must be shifted by the height the older rows added.
      requestAnimationFrame(() => {
        const after = scroller.current;
        if (after) after.scrollTop = after.scrollTop + (after.scrollHeight - beforeHeight);
      });
    }
  }

  function answer(allow: boolean, answers?: Record<string, string>) {
    if (!card.pending || answered) return;
    setAnsweredId(card.pending.id);
    void Promise.resolve(onAnswer(allow, answers)).catch(() => setAnsweredId(null));
  }

  async function send(text: string) {
    stick.current = true;
    await sends.track(text, () => onSend(text));
  }

  const entries = groupThread(transport.useView(sends.items));

  return (
    <>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          // "Near the top" means the scroll is within one page of the start; load the next older page.
          if (el.scrollTop < 80 && page.start > 0 && !loadingOlder) {
            void loadOlder(page.start);
          }
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          reportTop(el);
        }}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
      >
        {page.start > 0 && (
          <div className="self-center text-[11px] text-faint">
            {loadingOlder ? <Spinner size={10} /> : "Scroll up for earlier messages"}
          </div>
        )}
        {entries.length === 0 && !live && empty}
        <FileLinkContext.Provider value={card.id}>
          <FileIndexContext.Provider value={fileIndex}>
            <ThreadEntries entries={entries} live={live} streaming={streaming} editFrom={editFrom} onSend={send} cardId={card.id} />
          </FileIndexContext.Provider>
        </FileLinkContext.Provider>
        {card.column === "running" && !streaming && (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <Spinner size={12} /> Working…
          </div>
        )}
        {card.error && !live && !firstMessageFailed(card, page.items) && (
          <div className="rounded-md bg-danger-soft px-3 py-2 font-mono text-[12px] text-danger">
            {card.error}
            {/* The free Puku cap is a paywall: Pro lifts it. */}
            {isPukuCapError(card.error) && (
              <button type="button" onClick={() => openUpgrade("puku-cap")} className="ml-2 font-sans font-medium underline hover:opacity-80">
                Upgrade to Pro
              </button>
            )}
          </div>
        )}
        <FirstMessageErrorBanner
          card={card}
          items={page.items}
          openSettings={onOpenSettings}
          onDeleted={onDeleted}
        />
      </div>

      {!readOnly && <YouFirst cardId={card.id} />}
      <PermissionRequest card={card} readOnly={readOnly} answered={answered} answer={answer} />
      <TaskStrip cardId={card.id} tasks={card.tasks} onStop={transport.stopTask} />
      {footer}
      <ThreadReply card={card} show={showReply} live={live} placeholder={placeholder} question={question} scheduling={scheduling} editLast={editLast} onEditing={onEditing} onSend={send} track={sends.track} />
    </>
  );
}
