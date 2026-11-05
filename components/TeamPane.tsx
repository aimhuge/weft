"use client";

// The pane column of a teammate's card (lib/team-host.ts): the page it opened, read-only. A page it wrote (a blob in
// the team's workspace) loads through this Mac's server with the team's org (app/api/worker-board/page/[sha]?org=), in
// the native pane in the desktop app and in a sandboxed frame elsewhere; a site loads as it is; a page that only exists
// on their Mac shows its last capture. No simulator, no taps, no star or archive: none of it is yours to drive.
import { paneFromUrl } from "@/lib/share-types";
import type { BrowserState } from "@/lib/client";
import type { Card, TeamMark } from "@/lib/types";
import { teamMacLabel } from "@/lib/team-board-types";
import { nativePageUrl, useNativePage } from "@/lib/worker-native-page";
import { guarded } from "./guarded";
import TeamOwnerMark from "./TeamOwnerMark";

const BrowserPane = guarded(() => import("./BrowserPane"), { what: "browser pane", className: "m-3 w-[360px] self-start" });

export interface TeamPaneProps {
  card: Card & { team: TeamMark };
  url: string;
  browser: { desktop: boolean; state: BrowserState; obscured: boolean; width: number; onWidth: (width: number) => void };
  onClose: () => void;
}

export default function TeamPane({ card, url, browser, onClose }: TeamPaneProps) {
  const pane = paneFromUrl(url);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const page = nativePageUrl(pane, origin, card.team.org);
  const native = browser.desktop ? page : null;
  useNativePage(card.id, native, browser.state.url);
  const mark = <TeamOwnerMark mark={card.team} avatar />;
  if (native) return <BrowserPane {...browser} expanded onClose={onClose} actions={mark} />;
  return (
    <div className="flex h-full min-w-0 flex-col border-l border-line">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">{mark}</div>
        <button type="button" onClick={onClose} aria-label="Close the pane" className="rounded-md px-1.5 text-muted hover:bg-sunken hover:text-ink">×</button>
      </div>
      {pane?.kind === "blob" && page ? (
        <iframe title="Card page" src={page} sandbox="allow-scripts" className="size-full border-0 bg-white" />
      ) : pane?.kind === "site" ? (
        <a href={pane.url} target="_blank" rel="noreferrer" className="m-auto text-[13px] text-accent underline">{pane.url}</a>
      ) : (
        <p className="m-auto max-w-xs px-6 text-center text-[12.5px] text-faint">
          {pane ? `This page only exists on ${teamMacLabel(card.team)}.` : "Nothing in this card's pane yet."}
        </p>
      )}
    </div>
  );
}
