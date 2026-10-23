"use client";

// The framed window over the board (New thread, or an open card) and the open card's four-column
// workspace inside it: thread | editor | pane | show, in order. The columns remember which are open
// and how wide each is (lib/use-workspace-layout.ts); closing the last open column is a no-op so the
// card always has at least its thread.
import type { ReactNode } from "react";
import type { BrowserState } from "@/lib/client";
import type { Card, ThreadItem } from "@/lib/types";
import type { UseWorkspaceLayout } from "@/lib/use-workspace-layout";
import type { threadHandlers } from "@/lib/thread-handlers";
import type { planResets } from "@/lib/schedule";
import { NO_DRAG } from "@/lib/no-drag";
import { guarded } from "./guarded";

const BrowserPane = guarded(() => import("./BrowserPane"), { what: "browser pane", className: "m-3 w-[360px] self-start" });
const PaneCardMarks = guarded(() => import("./PaneCardMarks"), { inline: true, what: "card marks" });
const ShowRail = guarded(() => import("./ShowRail"), { what: "show rail", className: "w-[72px] shrink-0" });
const ThreadPanel = guarded(() => import("./ThreadPanel"), { what: "thread", className: "m-3 w-[360px] self-start" });
// The four-column workspace that holds the thread + editor + pane + show when a card is open.
const CardWorkspace = guarded(() => import("./CardWorkspace"), { what: "card workspace", className: "flex-1 min-w-0" });
// The code/markdown editor column, in its own CrashGuard so a broken editor leaves the thread and the pane.
const EditorColumn = guarded(() => import("./EditorColumn"), { what: "editor column" });

// The backdrop and the window: framed while a card or New thread is open, else `contents` so the
// children (none) take no space. `bottom` stops the window above an open terminal drawer.
export function CardFrame({ framed, bottom, onBackdrop, children }: { framed: boolean; bottom?: number; onBackdrop: () => void; children: ReactNode }) {
  return (
    <>
      {framed && <div style={NO_DRAG} className="fixed inset-0 z-30 bg-black/40" onClick={onBackdrop} aria-hidden="true" />}
      <div style={framed ? { ...NO_DRAG, bottom } : undefined} className={framed ? "fixed inset-4 z-40 flex overflow-hidden rounded-xl border border-line-strong bg-panel shadow-2xl" : "contents"}>
        {children}
      </div>
    </>
  );
}

export interface OpenCardProps {
  card: Card;
  // Send, answer, release, delete, rename, mode, New chat and close (lib/thread-handlers.ts).
  handlers: ReturnType<typeof threadHandlers>;
  items: ThreadItem[];
  streaming: string;
  resets: ReturnType<typeof planResets>;
  editTitle: boolean;
  workspace: UseWorkspaceLayout;
  browser: { desktop: boolean; state: BrowserState; width: number; onWidth: (width: number) => void; obscured: boolean };
  onStar: () => void;
  onTags: () => void;
  onShare: () => void;
  onArchive: () => void;
  // The first-message-error banner's "Pick a backup model" jumps to Settings → Models.
  onOpenSettings: () => void;
}

export default function OpenCard({ card, handlers, items, streaming, resets, editTitle, workspace, browser, onStar, onTags, onShare, onArchive, onOpenSettings }: OpenCardProps) {
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
            editorOpen={workspace.layout.open.editor}
            onEditor={() => workspace.toggle("editor")}
            editTitle={editTitle}
            className="flex h-full min-h-0 w-full flex-col bg-panel"
          />
        ),
        editor: <EditorColumn cardId={card.id} cwd={card.cwd} onClose={() => workspace.setOpen("editor", false)} />,
        pane: (
          <BrowserPane
            desktop={browser.desktop}
            state={browser.state}
            obscured={browser.obscured || workspace.dragging}
            width={browser.width}
            onWidth={browser.onWidth}
            // The pane's X closes the pane column, not the card; the card is closed from
            // the thread column's X or the framed window's backdrop / Escape.
            onClose={() => workspace.setOpen("pane", false)}
            expanded
            actions={<PaneCardMarks card={card} onShare={onShare} onStar={onStar} onArchive={onArchive} />}
          />
        ),
        show: <ShowRail card={card} hidden={false} items={items} pageUrl={browser.state.url} />,
      }}
    />
  );
}
