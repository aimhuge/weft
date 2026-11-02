"use client";

// The open card on weft.zip, framed the way the desktop opens one (components/OpenCard.tsx's CardFrame: a window inset
// over the board, with a backdrop): the desktop's own ThreadPanel on the left (its header, ThreadView and ReplyBox, fed
// by the cloud transport the board provides, useCloudTransport.ts), the card's browser pane (WebPane) and the desktop's
// own show rail (components/ShowRail.tsx) on the right, as a worker card opens on the desktop (lib/use-project-host.ts).
//
// The header's rename, ★, archive, tags, CLI and model pickers and the mode picker are the desktop's, over the board's
// host verbs (`edits`, useWebCards.tsx); a teammate's card gets none of them and no reply box. ⌘F and ⌘G find in the
// thread, as the desktop's menu does. What this board sent the card that hasn't reached it yet shows above the box
// (WebReplyStatus).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { requestThreadFind, stepThreadFind } from "@/lib/find-events";
import { paneFor, paneFromUrl } from "@/lib/share-types";
import type { GrantScope } from "@/lib/cloud-commands";
import { ThreadTransportContext, useThreadTransport } from "@/lib/thread-transport";
import type { Card, QuestionReply, ThreadItem } from "@/lib/types";
import type { BoardInput } from "@/lib/worker-commands";
import ShowRail from "../ShowRail";
import ThreadPanel from "../ThreadPanel";
import { CardFrame } from "../OpenCard";
import { WebPane } from "./WebPane";
import type { WebCardEdits } from "./useWebCards";

// A page the rail reopened, held while the card stays on the page it had then (as lib/use-project-host.ts does).
type Picked = { card: string; page: string | undefined; url: string };

// What a page's picture in the rail can be: the card's last pane capture, when it's a picture the board can load.
const shotsOf = (page: string | undefined, thumb: string | undefined): Record<string, string> => (page && thumb && /^https?:/.test(thumb) ? { [page]: thumb } : {});

// Escape closes; ⌘F opens find in the thread and ⌘G / ⇧⌘G step through it (the desktop's Edit menu, electron/menus.cjs).
function usePanelKeys(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "f") requestThreadFind();
      else if (key === "g") stepThreadFind(e.shiftKey ? -1 : 1);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

export function WebThreadPanel({
  orgId,
  card,
  seed,
  shown,
  readOnly,
  edits,
  editTitle = false,
  onScreenInput,
  footer,
  onClose,
  onSend,
  onAnswer,
}: {
  orgId: string;
  card: Card;
  // The thread the server read for a ?card= link, so the first paint isn't empty; the view reads it again itself.
  seed: ThreadItem[];
  // What the thread view draws now (raw, blob refs and all), for the pane and the rail to follow.
  shown: ThreadItem[];
  // A teammate's card: only the Mac of the account that runs it obeys, so there's no reply box.
  readOnly: boolean;
  // The header's card controls, on your own card.
  edits?: WebCardEdits;
  // Opened from the menu's Rename…: the title starts in its field.
  editTitle?: boolean;
  // Taps and swipes on a worker's live screen.
  onScreenInput?: (input: BoardInput) => Promise<void>;
  footer: ReactNode;
  onClose: () => void;
  onSend: (text: string) => Promise<void>;
  // A refused answer rejects, so the prompt's buttons come back.
  onAnswer: (allow: boolean, answers?: Record<string, string>, reply?: QuestionReply, grant?: GrantScope) => void | Promise<void>;
}) {
  const transport = useThreadTransport();
  // A teammate's card keeps its header to itself: its owner's machine wouldn't take the change.
  const own = useMemo(() => (edits ? transport : { ...transport, cardEdits: false }), [edits, transport]);
  const [picked, setPicked] = useState<Picked | null>(null);
  const reopened = picked && picked.card === card.id && picked.page === card.page ? picked.url : null;
  // The card's own page when the thread loaded so far doesn't reach its last open_url (newest 50 first), or the page
  // the rail reopened. A worker's live screen is only ever on the card, so it wins while it's the card's page.
  const pane = useMemo(() => {
    const page = paneFromUrl(card.page ?? "");
    if (page?.kind === "screen") return page;
    return (reopened ? paneFromUrl(reopened) : null) ?? paneFor(shown) ?? page;
  }, [shown, card.page, reopened]);
  const shots = useMemo(() => shotsOf(card.page, card.thumb), [card.page, card.thumb]);
  usePanelKeys(onClose);

  return (
    <CardFrame framed onBackdrop={onClose} label={card.title}>
      <ThreadTransportContext.Provider value={own}>
        <ThreadPanel
          key={card.id}
          card={card}
          items={seed}
          streaming=""
          readOnly={readOnly}
          footer={footer}
          onClose={onClose}
          onSend={onSend}
          onAnswer={onAnswer}
          editTitle={editTitle}
          {...edits}
          // The desktop's thread width (ThreadPanel's default) from md up, so the pane beside it gets the rest; a bare
          // w-full took the whole row and left the pane 0px wide. A phone hides the pane, so the thread fills it there.
          className="flex h-full min-h-0 w-full flex-col bg-panel md:w-[44%] md:min-w-[380px] md:shrink-0"
        />
      </ThreadTransportContext.Provider>
      <WebPane orgId={orgId} pane={pane} thumbUrl={card.thumb && /^https?:/.test(card.thumb) ? card.thumb : undefined} onScreenInput={onScreenInput} mobileApp={card.mobileApp} />
      <div className="hidden md:flex">
        <ShowRail card={card} hidden={false} items={shown} pageUrl={reopened ?? card.page ?? ""} shots={shots} onReopen={(url) => setPicked({ card: card.id, page: card.page, url })} />
      </div>
    </CardFrame>
  );
}
