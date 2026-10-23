"use client";

// The /s/[id] viewer's two halves: the card's thread on the left (chronological, follows the
// bottom like WebThreadPanel) and the page its browser pane showed on the right. Below 900px a
// Thread | Page toggle replaces the split (CSS @ media). The page polls /api/s/[id]/live every
// SHARE_POLL_MS while its tab is visible; the merge is in lib/share-view.ts.
//
// A tool result trimmed by the outbox (TOOL_RESULT_INLINE_MAX) is fetched through a fake
// ToolResultSource that just says "Long output isn't shared" — there's no API route to serve a
// tool output, by design: a share link shouldn't be a way to read the owner's transcripts at
// length.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cardTags } from "@/lib/rail-view";
import { COLUMNS } from "@/lib/types";
import { ToolResultSourceContext, type ToolResultSource } from "@/lib/use-tool-result";
import { chronological, rewriteBlobRefs, seqOf } from "@/lib/web-board";
import type { ThreadItem } from "@/lib/types";
import { SHARE_POLL_MS, type ShareCard, type ShareLive, type SharePane } from "@/lib/share-types";
import { canLoadEarlier, mergeShareLive, newestSeq, oldestSeq } from "@/lib/share-view";
import { groupThread, ThreadEntries } from "../ThreadItems";
import { PaneFrame } from "./PaneFrame";
import "./share-view.css";

// The tool-result source the viewer provides: tool outputs over TOOL_RESULT_INLINE_MAX are
// already cut out of the row (lib/cloud-sync.ts), and there's no route to fetch one. The user
// sees a one-line message instead — clearer than a long network error.
const UNSHARED_TOOL_OUTPUT: ToolResultSource = () => Promise.resolve("Long output isn't shared.");

type LiveStatus = "live" | "offline";

export function SharedCard({ id, initial }: { id: string; initial: ShareLive }) {
  const [live, setLive] = useState<ShareLive>(initial);
  const [status, setStatus] = useState<LiveStatus>("live");
  const [view, setView] = useState<"thread" | "pane">("thread");
  const card = live.card;
  const column = COLUMNS.find((c) => c.id === card.column);
  const { shown: tags } = cardTags(card.tags);

  // Pure merge: a poll's response is folded into the current state by seq.
  const mergeOne = (next: ShareLive) => {
    setLive((prev) => mergeShareLive(prev, next));
    setStatus("live");
  };
  const mergeError = () => setStatus("offline");

  // Poll for newer items while the tab is visible. `after` is the current newest seq; an empty
  // response (no new items) is still a 200, so a successful poll keeps the dot green.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") {
        timer = setTimeout(tick, SHARE_POLL_MS);
        return;
      }
      const after = newestSeq(live);
      fetch(`/api/s/${id}/live?after=${after}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
        .then((next: ShareLive) => {
          if (cancelled) return;
          mergeOne(next);
        })
        .catch(() => {
          if (cancelled) return;
          mergeError();
        })
        .finally(() => {
          if (!cancelled) timer = setTimeout(tick, SHARE_POLL_MS);
        });
    };
    timer = setTimeout(tick, SHARE_POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [id, live]);

  const onLoadOlder = () => {
    const before = oldestSeq(live) - 1;
    if (before < 0) return;
    fetch(`/api/s/${id}/live?before=${before}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((next: ShareLive) => mergeOne(next))
      .catch(() => mergeError());
  };

  // The thread items the panel shows: live.items is `{seq, item}[]` (lib/share-types.ts); the
  // web-board helpers (chronological, rewriteBlobRefs) expect ThreadItem[] with a `__seq` carrier,
  // so we re-tag with that carrier here.
  const SEQ_FIELD = "__seq" as const;
  const stampSeq = (item: ThreadItem, seq: number): ThreadItem => Object.assign({}, item, { [SEQ_FIELD]: seq });
  const threadItems = useMemo(
    () => live.items.map((s) => stampSeq(s.item, s.seq)),
    [live.items],
  );
  const entries = useMemo(
    () => groupThread(rewriteBlobRefs(chronological(threadItems), live.blobUrls)),
    [threadItems, live.blobUrls],
  );

  // The thread panel follows the bottom while the user is at the bottom (FOLLOW_SLACK), like
  // WebThreadPanel. A new card (the id is stable on one page) keeps following on first paint.
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const newest = live.items[0] ? seqOf(live.items[0].item) : undefined;
  useLayoutEffect(() => {
    following.current = true;
  }, [card.id]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [card.id, newest]);

  return (
    <ToolResultSourceContext.Provider value={UNSHARED_TOOL_OUTPUT}>
      <div className="wz-desk" data-theme="dark">
        <div className="wz-share">
          <SharedHeader card={card} columnLabel={column?.label ?? "Card"} status={status} tags={tags} />
          <div className="wz-shareMain">
            <section
              className="wz-shareThread"
              data-hidden={view === "pane" ? "true" : "false"}
              aria-label="Thread"
            >
              <div className="wz-shareToggle" role="tablist" aria-label="View">
                <button type="button" role="tab" aria-selected={view === "thread"} data-active={view === "thread"} onClick={() => setView("thread")}>Thread</button>
                <button type="button" role="tab" aria-selected={view === "pane"} data-active={view === "pane"} onClick={() => setView("pane")}>Page</button>
              </div>
              <div
                ref={scroller}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                }}
                className="wz-shareScroller"
              >
                {canLoadEarlier(live) && (
                  <button type="button" onClick={onLoadOlder} className="wz-shareLoadMore">
                    Load earlier messages
                  </button>
                )}
                {entries.length === 0 && <p className="wz-shareEmpty">Nothing in this thread has synced yet.</p>}
                <ThreadEntries entries={entries} live={false} streaming="" cardId={card.id} />
              </div>
              <p className="wz-shareFooter">Read-only: reply to this thread in the Weft desktop app on the owner&apos;s Mac.</p>
            </section>
            <section className="wz-sharePane" data-hidden={view === "thread" ? "true" : "false"} aria-label="Browser pane">
              <SharedPane id={id} pane={live.pane} thumb={card.thumb} blobUrls={live.blobUrls} />
            </section>
          </div>
        </div>
      </div>
    </ToolResultSourceContext.Provider>
  );
}

function SharedHeader({ card, columnLabel, status, tags }: { card: ShareCard; columnLabel: string; status: LiveStatus; tags: string[] }) {
  return (
    <header className="wz-shareHeader">
      <h1 className="wz-shareTitle">
        {card.emoji && <span aria-hidden>{card.emoji}</span>}
        <span>{card.title}</span>
      </h1>
      <span className="wz-shareColumn">{columnLabel}</span>
      {tags.map((tag) => (
        <span key={tag} className="wz-shareColumn">{tag}</span>
      ))}
      <div className="flex-1" />
      <span className="wz-shareLive" data-live={status} aria-live="polite">
        <span aria-hidden="true" />
        {status === "live" ? "Live" : "Offline"}
      </span>
      <a className="wz-shareBrand" href="https://weft.zip" target="_blank" rel="noopener noreferrer">Shared from Weft</a>
    </header>
  );
}

function SharedPane({ id, pane, thumb, blobUrls }: { id: string; pane: SharePane | null; thumb?: string; blobUrls: Record<string, string> }) {
  if (!pane) {
    return (
      <>
        <div className="wz-sharePaneToolbar">
          <span>No page open</span>
        </div>
        <PanePlaceholder thumb={thumb} blobUrls={blobUrls} />
      </>
    );
  }
  if (pane.kind === "blob") {
    const url = `/api/s/${id}/page/${pane.ref.replace(/^blob:sha256:/, "")}${pane.hash}`;
    return (
      <>
        <div className="wz-sharePaneToolbar">
          <span>{pane.label || "Page"}</span>
        </div>
        <PaneFrame title="Shared page" src={url} sandbox="allow-scripts allow-popups allow-forms" openHref={url} />
      </>
    );
  }
  if (pane.kind === "site") {
    return (
      <>
        <div className="wz-sharePaneToolbar">
          <span>{pane.label}</span>
          <div className="flex-1" />
          <a href={pane.url} target="_blank" rel="noopener noreferrer" className="wz-shareBrand" style={{ marginLeft: 0 }}>
            Open ↗
          </a>
        </div>
        <PaneFrame title="Shared page" src={pane.url} sandbox="allow-scripts allow-popups allow-forms" openHref={pane.url} />
      </>
    );
  }
  // local: the pane is on the owner's Mac (a localhost URL or a file:// path). Show the card's
  // most recent pane capture, with a quiet note that this is a snapshot.
  return (
    <>
      <div className="wz-sharePaneToolbar">
        <span>Running on the owner&apos;s Mac: {pane.label}</span>
      </div>
      <PanePlaceholder thumb={thumb} blobUrls={blobUrls} />
    </>
  );
}

function PanePlaceholder({ thumb, blobUrls }: { thumb?: string; blobUrls: Record<string, string> }) {
  if (thumb && thumb.startsWith("blob:sha256:") && blobUrls[thumb]) {
    return (
      <>
        <img src={blobUrls[thumb]} alt="Card pane capture" className="wz-sharePaneImage" />
        <p className="wz-sharePaneCaption">A snapshot of the page on the owner&apos;s Mac.</p>
      </>
    );
  }
  return <p className="wz-shareEmpty">No pane capture yet.</p>;
}
