"use client";

// The framed window over the board (New thread, or an open card) and the open card's four-column
// workspace inside it: thread | editor | pane | show, in order. The columns remember which are open
// and how wide each is (lib/use-workspace-layout.ts); closing the last open column is a no-op so the
// card always has at least its thread.
import type { ReactNode } from "react";
import type { ProjectWorker } from "@/lib/board-view";
import type { BrowserState } from "@/lib/client";
import type { Card, ThreadItem } from "@/lib/types";
import type { UseWorkspaceLayout } from "@/lib/use-workspace-layout";
import type { ThreadHandlerSet } from "@/lib/thread-handlers";
import type { planResets } from "@/lib/schedule";
import { NO_DRAG } from "@/lib/no-drag";
import { FilesSourceContext } from "@/lib/files-source";
import { PaneOpenContext } from "@/lib/pane-open";
import { ThreadTransportContext } from "@/lib/thread-transport";
import { useProjectHost } from "@/lib/use-project-host";
import { ToolResultSourceContext } from "@/lib/use-tool-result";
import { useWorkerQueued } from "@/lib/worker-acts";
import { guarded } from "./guarded";

const BrowserPane = guarded(() => import("./BrowserPane"), { what: "browser pane", className: "m-3 w-[360px] self-start" });
const PaneCardMarks = guarded(() => import("./PaneCardMarks"), { inline: true, what: "card marks" });
const ShowRail = guarded(() => import("./ShowRail"), { what: "show rail", className: "w-[72px] shrink-0" });
const ThreadPanel = guarded(() => import("./ThreadPanel"), { what: "thread", className: "m-3 w-[360px] self-start" });
// The four-column workspace that holds the thread + editor + pane + show when a card is open.
const CardWorkspace = guarded(() => import("./CardWorkspace"), { what: "card workspace", className: "flex-1 min-w-0" });
// The code/markdown editor column, in its own CrashGuard so a broken editor leaves the thread and the pane.
const EditorColumn = guarded(() => import("./EditorColumn"), { what: "editor column" });
// A worker card's pane: the page it opened, framed through this Mac's server, or its live screen.
const WorkerPane = guarded(() => import("./WorkerPane"), { what: "worker pane", className: "m-3 w-[360px] self-start" });

// The backdrop and the window: framed while a card or New thread is open, else `contents` so the
// children (none) take no space. `bottom` stops the window above an open terminal drawer. The framed
// window is a dialog — it sits over the board with a backdrop and takes the focus — so it says so.
// `label` names it (the card's title on weft.zip); the desktop leaves it to the panel's own heading.
export function CardFrame({ framed, bottom, onBackdrop, label, children }: { framed: boolean; bottom?: number; onBackdrop: () => void; label?: string; children: ReactNode }) {
  return (
    <>
      {framed && <div data-backdrop style={NO_DRAG} className="fixed inset-0 z-30 bg-black/40" onClick={onBackdrop} aria-hidden="true" />}
      <div
        role={framed ? "dialog" : undefined}
        aria-modal={framed ? true : undefined}
        aria-label={framed ? label : undefined}
        style={framed ? { ...NO_DRAG, bottom } : undefined}
        className={framed ? "fixed inset-4 z-40 flex overflow-hidden rounded-xl border border-line-strong bg-panel shadow-2xl" : "contents"}
      >
        {children}
      </div>
    </>
  );
}

export interface OpenCardProps {
  card: Card;
  // Send, answer, release, delete, rename, mode, New chat and close (lib/thread-handlers.ts).
  handlers: ThreadHandlerSet;
  items: ThreadItem[];
  streaming: string;
  resets: ReturnType<typeof planResets>;
  editTitle: boolean;
  workspace: UseWorkspaceLayout;
  browser: { desktop: boolean; state: BrowserState; width: number; onWidth: (width: number) => void; obscured: boolean };
  onStar: () => void;
  onTags: () => void;
  // Share… links a card this Mac syncs, so a worker's card has none.
  onShare?: () => void;
  onArchive: () => void;
  // The first-message-error banner's "Pick a backup model" jumps to Settings → Models.
  onOpenSettings: () => void;
  // The worker the card runs on, when it isn't this Mac (docs/architecture/project-hosts.md).
  worker?: ProjectWorker;
}

// A worker that's offline still takes what you send: it waits in the queue (lib/worker-board.ts). The same line says how
// many of this card's changes wait for the worker to take them (lib/worker-acts.ts): drawn already, and run in order.
function WorkerNote({ worker, cardId }: { worker?: ProjectWorker; cardId: string }) {
  const queued = useWorkerQueued(cardId);
  if (worker?.status !== "offline" && !queued) return null;
  const name = worker?.name ?? "Your worker";
  const waits = queued ? `${queued === 1 ? "1 change waits" : `${queued} changes wait`} for ${name} to take ${queued === 1 ? "it" : "them, in order"}.` : "What you send here waits until it's back.";
  return <p className="shrink-0 border-t border-line px-4 py-2 text-[12.5px] text-faint">{worker?.status === "offline" ? `${name} is offline. ` : ""}{waits}</p>;
}

// Where the editor would be, for a card whose files are on another machine: said once, not a silent empty column.
function NotOnHost({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 border-l border-line px-6 text-center text-[12.5px] text-faint">
      <p>The editor can&apos;t open this card&apos;s files: its host doesn&apos;t serve them yet.</p>
      <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-muted hover:bg-sunken hover:text-ink">Close the editor</button>
    </div>
  );
}

// The open card in its host's context (lib/use-project-host.ts): the thread reads and acts through the host's transport,
// so the same columns serve a card on this Mac and one on a worker. The editor reads and saves through the host's files
// (lib/files-source.ts: this Mac's card routes, or a worker's file verbs). What only this Mac has (its pane, its page
// pictures) comes from the host or says it isn't there.
export default function OpenCard(props: OpenCardProps) {
  const { card, items, browser, workspace, onShare, onStar, onArchive } = props;
  const { host, items: shown, page } = useProjectHost(card, { items, pageUrl: browser.state.url });
  const closeEditor = () => workspace.setOpen("editor", false);
  const closePane = () => workspace.setOpen("pane", false);
  // Share… links a card this Mac syncs; a worker's card isn't one of those.
  const share = host.can("share") ? onShare : undefined;
  const marks = <PaneCardMarks card={card} onShare={share} onStar={onStar} onArchive={onArchive} />;
  return (
    <ToolResultSourceContext.Provider value={host.tools}>
      <FilesSourceContext.Provider value={host.files}>
        <ThreadTransportContext.Provider value={host.thread}>
          {/* A worker card's review tour puts its pages in this pane column, not this Mac's native pane (lib/pane-open.ts). */}
          <PaneOpenContext.Provider value={page.open}>
            <Workspace
              {...props}
              onShare={share}
              files={host.can("files")}
              footer={host.kind === "cloud" ? <WorkerNote worker={props.worker} cardId={card.id} /> : null}
              editor={host.can("files") ? <EditorColumn cardId={card.id} cwd={card.cwd} onClose={closeEditor} /> : <NotOnHost onClose={closeEditor} />}
              pane={
                host.can("pane") ? (
                  <BrowserPane
                    desktop={browser.desktop}
                    state={browser.state}
                    obscured={browser.obscured || workspace.dragging}
                    width={browser.width}
                    onWidth={browser.onWidth}
                    // The pane's X closes the pane column, not the card; the card is closed from
                    // the thread column's X or the framed window's backdrop / Escape.
                    onClose={closePane}
                    expanded
                    actions={marks}
                  />
                ) : (
                  <WorkerPane card={card} worker={props.worker} url={page.url} browser={{ ...browser, obscured: browser.obscured || workspace.dragging }} marks={marks} onClose={closePane} />
                )
              }
              show={<ShowRail card={card} hidden={false} items={shown} pageUrl={page.url} shots={page.shots} onReopen={page.open} />}
            />
          </PaneOpenContext.Provider>
        </ThreadTransportContext.Provider>
      </FilesSourceContext.Provider>
    </ToolResultSourceContext.Provider>
  );
}

type WorkspaceProps = OpenCardProps & { files: boolean; footer: ReactNode; editor: ReactNode; pane: ReactNode; show: ReactNode };

function Workspace({ card, handlers, items, streaming, resets, editTitle, workspace, onStar, onTags, onShare, onArchive, onOpenSettings, files, footer, editor, pane, show }: WorkspaceProps) {
  return (
    <CardWorkspace
      layout={workspace.layout}
      fill={workspace.fill}
      dragging={workspace.dragging}
      setDragging={workspace.setDragging}
      toggle={workspace.toggle}
      dragDivider={workspace.dragDivider}
      fitToContainer={workspace.fitToContainer}
      columns={{
        thread: (
          <ThreadPanel
            key={card.id}
            guardName={card.title}
            card={card}
            onStar={onStar}
            onTags={onTags}
            onShare={onShare}
            marksInPane={workspace.layout.open.pane}
            resets={resets}
            items={items}
            streaming={streaming}
            {...handlers}
            onArchive={onArchive}
            onOpenSettings={onOpenSettings}
            editorOpen={files && workspace.layout.open.editor}
            onEditor={files ? () => workspace.toggle("editor") : undefined}
            editTitle={editTitle}
            footer={footer}
            className="flex h-full min-h-0 w-full flex-col bg-panel"
          />
        ),
        editor,
        pane,
        show,
      }}
    />
  );
}
