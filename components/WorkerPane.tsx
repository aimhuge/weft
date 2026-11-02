"use client";

// The pane column of a worker card opened on the desktop board (components/OpenCard.tsx). The native pane is this
// Mac's own and knows nothing of the card, so this is the web board's pane (WebPane) on the page the card opened, or the
// one the show rail picked: a blob page framed through this Mac's server, a site, or the worker's live screen, which
// takes taps (WorkerScreen). Local Simulator runs the card's app on this Mac instead, so then its live view is a page
// in the native pane (docs/architecture/manual-qa.md). Either way the header's host chip (web-board/HostChip.tsx) names
// where the card runs and switches its simulator between the worker and this Mac.
import type { ReactNode } from "react";
import { paneFromUrl } from "@/lib/share-types";
import type { BrowserState } from "@/lib/client";
import type { Card } from "@/lib/types";
import type { ProjectWorker } from "@/lib/board-view";
import { sendWorkerAction } from "@/lib/worker-transport";
import { parseWorkerProject } from "@/lib/worker-project";
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
  // A page the card wrote can be an app, as in this Mac's own pane: it comes home on save (lib/mini-app-worker.ts).
  const save = pane?.kind === "blob" && <SaveAppButton url={url} title={card.title} />;
  if (local.on) {
    const actions = (
      <>
        {save}
        <HostChip worker={worker?.name} local={local} />
        {marks}
      </>
    );
    return <BrowserPane {...browser} expanded onClose={onClose} actions={actions} />;
  }
  return (
    <WebPane
      orgId={null}
      pane={pane}
      onClose={onClose}
      onScreenInput={(input) => sendWorkerAction({ action: "input", cardId: card.id, input }).then(() => {})}
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
