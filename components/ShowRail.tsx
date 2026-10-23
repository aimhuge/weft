"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { onTopTurn, pulse, scrollToTurn } from "@/lib/show-events";
import { isLive } from "@/lib/format";
import { showMinis, type Mini, type Visit } from "@/lib/show-rail";
import type { Card, ThreadItem } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { usePageShots } from "@/lib/use-page-shots";
import { usePaneFollow } from "@/lib/use-pane-follow";
import { PageTile, TurnRow } from "./ShowRailItems";

// Pages you opened in the pane by hand, per card, for this session only (the thread records the agent's).
const visits = new Map<string, Visit[]>();
const listeners = new Set<() => void>();
const NONE: Visit[] = [];
function recordVisit(card: string, url: string) {
  visits.set(card, [...(visits.get(card) ?? NONE), { url, at: Date.now() }]);
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

// The 72 px column right of the browser pane's page: one mini per turn of the open thread and per page
// the pane showed, oldest first with the newest at the bottom, like the chat. Pages are pictures of what the
// pane showed (lib/page-shots.ts); turns are a dot and their first words. Click a turn and the chat scrolls
// to it; click a page and the pane opens it again too, and a turn puts the pane back on the page it showed.
// Scroll the chat and the turn at its top lights up here, and the pane follows it to that turn's page.
// Hidden under 980 px of window, so the chat keeps its room on a 13" Air (docs/architecture/show-rail.md).
// card is the open thread (none: no rail); hidden while the New thread dialog takes its place; pageUrl is the pane's page.
export default function ShowRail({ card, hidden, items, pageUrl }: { card: Card | null | undefined; hidden: boolean; items: ThreadItem[]; pageUrl: string }) {
  const now = useNow();
  // The turn on top of the chat, per card, so switching cards starts with none marked.
  const [top, setTop] = useState<{ card?: string; id: string }>();
  const cardId = card?.id;
  const list = useRef<HTMLDivElement>(null);
  const cardVisits = useSyncExternalStore(subscribe, () => visits.get(cardId ?? "") ?? NONE, () => NONE);
  const shots = usePageShots(cardId, pageUrl, items.length);
  // The page last seen and a page the rail itself reopened, which isn't a new visit.
  const seen = useRef<{ card?: string; url: string }>(undefined);
  const reopened = useRef<string>(undefined);
  const reopen = (url: string) => {
    reopened.current = url;
    void window.weft?.browser.open(url);
  };
  const minis = card && !hidden ? showMinis(items, { live: isLive(card), now, visits: cardVisits }) : [];
  const follow = usePaneFollow(minis, pageUrl, reopen);
  // Newest is at the bottom, like the chat: follow it down unless you've scrolled up to look back.
  const atEnd = useRef(true);
  const count = minis.length;
  useEffect(() => {
    const el = list.current;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [count, cardId]);

  // A new page while the same card stays open is a visit; the first page after a switch is the card's own.
  useEffect(() => {
    const last = seen.current;
    seen.current = { card: cardId, url: pageUrl };
    if (!cardId || !pageUrl || last?.card !== cardId || last.url === pageUrl) return;
    if (reopened.current === pageUrl) reopened.current = undefined;
    else recordVisit(cardId, pageUrl);
  }, [cardId, pageUrl]);

  useEffect(
    () =>
      onTopTurn((id, bottom) => {
        setTop({ card: cardId, id });
        const mini = list.current?.querySelector<HTMLElement>(`[data-mini="${CSS.escape(id)}"]`);
        mini?.scrollIntoView({ block: "nearest" });
        pulse(mini);
        follow(id, bottom);
      }),
    // follow reads the newest minis and page through a ref, so it needn't re-subscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cardId],
  );

  if (!card || hidden) return null;
  const onScreen = minis.find((m) => m.dot === "page" && m.url === pageUrl)?.id;
  const active = top?.card === card.id ? top.id : undefined;
  const click = (m: Mini) => () => {
    setTop({ card: card.id, id: m.id });
    scrollToTurn(m.turn ?? m.id);
    // The pane goes back to the page on screen at that turn, if it's moved on since.
    if (m.url && m.url !== pageUrl) reopen(m.url);
  };
  return (
    <aside aria-label="Show" className="flex w-full min-w-0 flex-col border-l border-line bg-panel max-[979px]:hidden">
      <div className="sticky top-0 border-b border-line py-2.5 text-center text-[10px] uppercase tracking-[0.08em] text-muted">Show</div>
      <div
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1 py-2"
      >
        {minis.map((m) =>
          m.dot === "page" ? (
            <PageTile key={m.id} mini={m} active={m.id === active} onScreen={m.id === onScreen} shot={m.url ? shots[m.url] : undefined} onClick={click(m)} />
          ) : (
            <TurnRow key={m.id} mini={m} active={m.id === active} onClick={click(m)} />
          ),
        )}
      </div>
    </aside>
  );
}
