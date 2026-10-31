"use client";

// The right half of an open card on weft.zip, where the desktop shows its browser pane (components/BrowserPane.tsx):
// the same toolbar (back, forward, reload, the URL, close) over the page the card's pane last showed, as the thread
// tells it (lib/share-types.ts paneFor). A synced ~/.weft/show page is framed sandboxed through
// app/api/web-board/[orgId]/page/[sha]; a public site is framed as it is; a localhost or file page only exists on the
// Mac, so the card's latest pane capture stands in for it. The desktop board draws this too, for a worker's card
// (components/WorkerOpenCard.tsx), with orgId null: it frames through its own server, more tightly, because a frame there
// shares the board window's session (app/api/worker-board/page/[sha]), and that's why it never frames a public site.
import type { SharePane } from "@/lib/share-types";
import type { ScreenInput } from "@/lib/worker-commands";
import Icon from "../Icon";
import { WorkerScreen } from "./WorkerScreen";

const NAV = "rounded-md p-1.5 text-muted disabled:opacity-30";
const SANDBOX = "allow-scripts allow-popups allow-forms";
const BOARD_SANDBOX = "allow-scripts";

// What the toolbar's address field reads for each kind of page. A saved page shows its label and a
// public site its host: the address bar is for a visitor, not a file path.
function address(pane: SharePane | null): string {
  if (!pane) return "";
  if (pane.kind === "blob") return pane.label;
  if (pane.kind === "site") {
    try {
      return new URL(pane.url).host || pane.url;
    } catch {
      return pane.url;
    }
  }
  return pane.label;
}

function Snapshot({ src, note }: { src?: string; note: string }) {
  if (!src) return <p className="flex h-full items-center justify-center px-8 text-center text-[13px] text-faint">{note}</p>;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 overflow-auto p-4">
      <img src={src} alt="The card's last pane capture" className="max-h-[calc(100%-2rem)] max-w-full rounded-lg border border-line object-contain" />
      <p className="text-[12px] text-faint">{note}</p>
    </div>
  );
}

function PaneBody({ orgId, pane, thumbUrl, onScreenInput }: { orgId: string | null; pane: SharePane | null; thumbUrl?: string; onScreenInput?: (input: ScreenInput) => Promise<void> }) {
  if (pane?.kind === "screen") return <WorkerScreen pane={pane} onInput={onScreenInput} />;
  if (pane?.kind === "blob") {
    const sha = pane.ref.replace(/^blob:sha256:/, "");
    const src = orgId ? `/api/web-board/${orgId}/page/${sha}${pane.hash}` : `/api/worker-board/page/${sha}${pane.hash}`;
    return <iframe title="Card page" src={src} sandbox={orgId ? SANDBOX : BOARD_SANDBOX} className="size-full border-0 bg-white" />;
  }
  if (pane?.kind === "site" && !orgId) return <Snapshot note="This card opened a public site. Open ↗ shows it." />;
  if (pane?.kind === "site") return <iframe title="Card page" src={pane.url} sandbox={SANDBOX} className="size-full border-0 bg-white" />;
  if (pane?.kind === "local") return <Snapshot src={thumbUrl} note="This page only exists on the machine running this card." />;
  return <Snapshot src={thumbUrl} note="No page open in this card's browser pane." />;
}

// onClose: the toolbar's X, left out where the thread beside it carries the close (WebThreadPanel, so a phone, where
// the pane is hidden, still has one).
// onScreenInput: taps on a worker's live screen, where this board can send them (the desktop's).
export function WebPane({ orgId, pane, thumbUrl, onClose, onScreenInput }: { orgId: string | null; pane: SharePane | null; thumbUrl?: string; onClose?: () => void; onScreenInput?: (input: ScreenInput) => Promise<void> }) {
  return (
    <section aria-label="Browser pane" className="relative hidden min-w-0 flex-1 flex-col border-l border-line bg-panel md:flex">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <button className={NAV} disabled aria-label="Back">
          <Icon name="back" size={15} />
        </button>
        <button className={NAV} disabled aria-label="Forward">
          <Icon name="forward" size={15} />
        </button>
        <button className={NAV} disabled aria-label="Reload">
          <Icon name="reload" size={15} />
        </button>
        <input
          readOnly
          value={address(pane)}
          placeholder="No page open"
          aria-label="Page address"
          className="mx-1 min-w-0 flex-1 rounded-md border border-line bg-canvas px-2.5 py-1 font-mono text-[12px] text-ink outline-none placeholder:font-sans placeholder:text-faint"
        />
        {pane?.kind === "site" && (
          <a href={pane.url} target="_blank" rel="noopener noreferrer" className="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-sunken hover:text-ink">
            Open ↗
          </a>
        )}
        {onClose && (
          <button onClick={onClose} aria-label="Close thread" title="Close (Esc)" className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink">
            <Icon name="x" size={15} />
          </button>
        )}
      </div>
      <div className="relative min-h-0 flex-1 bg-canvas">
        <PaneBody orgId={orgId} pane={pane} thumbUrl={thumbUrl} onScreenInput={onScreenInput} />
      </div>
    </section>
  );
}
