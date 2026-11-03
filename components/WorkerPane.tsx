"use client";

// The pane column of a worker card opened on the desktop board (components/OpenCard.tsx), on the page the card opened
// or the one the show rail picked. In the desktop app a page the card wrote (a blob, framed through this Mac's server)
// and a site load in this Mac's native pane, like a local card's pages, with its address bar, tabs, zoom, find and
// tools (lib/worker-native-page.ts). The worker's live screen, which takes taps (WorkerScreen), a page that only
// exists on the worker, and no page yet stay the web board's pane (WebPane), as they are on weft.zip. Local Simulator
// runs the card's app on this Mac instead, so then its live view is a page in the native pane
// (docs/architecture/manual-qa.md). Either way the header's host chip (web-board/HostChip.tsx) names where the card
// runs and switches its simulator between the worker and this Mac.
import type { ReactNode } from "react";
import { paneFromUrl } from "@/lib/share-types";
import type { BrowserState } from "@/lib/client";
import type { Card } from "@/lib/types";
import type { BoardInput } from "@/lib/worker-commands";
import type { ProjectWorker } from "@/lib/board-view";
import { sendWorkerAction } from "@/lib/worker-transport";
import { parseWorkerProject } from "@/lib/worker-project";
import { nativePageUrl, savedPageUrl, useNativePage } from "@/lib/worker-native-page";
import { guarded } from "./guarded";
import { useLocalSimulator } from "./use-local-simulator";
import SaveAppButton from "./SaveAppButton";
import { HostChip } from "./web-board/HostChip";
import { WebPane } from "./web-board/WebPane";

const BrowserPane = guarded(() => import("./BrowserPane"), { what: "browser pane", className: "m-3 w-[360px] self-start" });

export interface WorkerPaneProps {
  card: Card;
  worker?: ProjectWorker;
  // The page on show: the card's own, or one the show rail reopened (lib/use-project-host.ts).
  url: string;
  browser: { desktop: boolean; state: BrowserState; obscured: boolean; width: number; onWidth: (width: number) => void };
  // The card's share, star and archive (components/PaneCardMarks.tsx), beside the host chip.
  marks: ReactNode;
  onClose: () => void;
}

export default function WorkerPane({ card, worker, url, browser, marks, onClose }: WorkerPaneProps) {
  const local = useLocalSimulator(card);
  const pane = paneFromUrl(url);
  const native = browser.desktop && !local.on ? nativePageUrl(pane, window.location.origin) : null;
  useNativePage(card.id, native, browser.state.url);
  const onScreenInput = (input: BoardInput) => sendWorkerAction({ action: "input", cardId: card.id, input }).then(() => {});
  if (local.on || native) {
    // The native pane's own Save as app saves its page: a worker card's goes back to its blob ref.
    const save = native ? undefined : pane?.kind === "blob" && <SaveAppButton url={url} title={card.title} />;
    const actions = (
      <>
        {save}
        {native ? <HostChip worker={worker?.name} onScreenInput={onScreenInput} mobileApp={card.mobileApp} local={local} /> : <HostChip worker={worker?.name} local={local} />}
        {marks}
      </>
    );
    return <BrowserPane {...browser} expanded onClose={onClose} actions={actions} saveUrl={savedPageUrl(browser.state.url)} />;
  }
  // A page the card wrote can be an app, as in this Mac's own pane: it comes home on save (lib/mini-app-worker.ts).
  const save = pane?.kind === "blob" && <SaveAppButton url={url} title={card.title} />;
  return (
    <WebPane
      orgId={null}
      pane={pane}
      onClose={onClose}
      onScreenInput={onScreenInput}
      actions={
        <>
          {save}
          {marks}
        </>
      }
      local={local}
      source={worker?.name}
      workerId={parseWorkerProject(card.cwd)?.workerId}
      mobileApp={card.mobileApp}
    />
  );
}
