"use client";

// A worker's card opened on the desktop board: the same ThreadPanel the web board opens (with no card on this Mac,
// the thread reads and acts through lib/worker-transport.ts, so the panel offers what the web's does), and the web's
// pane beside it, on the page the card last opened: the native pane is this Mac's, and it knows nothing of the card.
// The editor and the show rail read this Mac's files, so they aren't here.
import { paneFromUrl } from "@/lib/share-types";
import { ThreadTransportContext } from "@/lib/thread-transport";
import { ToolResultSourceContext } from "@/lib/use-tool-result";
import type { WorkerThread } from "@/lib/use-worker-board";
import { sendWorkerAction, workerToolSource, workerTransport } from "@/lib/worker-transport";
import { guarded } from "./guarded";
import { WebPane } from "./web-board/WebPane";

const ThreadPanel = guarded(() => import("./ThreadPanel"), { what: "thread", className: "m-3 w-[360px] self-start" });

export default function WorkerOpenCard({ thread }: { thread: WorkerThread }) {
  const { card, worker, handlers } = thread;
  return (
    <ToolResultSourceContext.Provider value={workerToolSource}>
      <ThreadTransportContext.Provider value={workerTransport}>
        <ThreadPanel
          key={card.id}
          guardName={card.title}
          card={card}
          items={[]}
          streaming=""
          footer={worker.status === "offline" ? <p className="shrink-0 border-t border-line px-4 py-2 text-[12.5px] text-faint">{worker.name} is offline. What you send here waits until it&apos;s back.</p> : undefined}
          {...handlers}
          className="flex h-full min-h-0 w-[44%] min-w-[380px] shrink-0 flex-col bg-panel"
        />
        <WebPane
          orgId={null}
          pane={paneFromUrl(card.page ?? "")}
          onClose={handlers.onClose}
          onScreenInput={(input) => sendWorkerAction({ action: "input", cardId: card.id, input })}
        />
      </ThreadTransportContext.Provider>
    </ToolResultSourceContext.Provider>
  );
}
