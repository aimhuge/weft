"use client";

// The board's framed window: the New thread form, or the open card's thread, in the frame that
// sits over the columns. It is its own component so Board.tsx stays a short list of what the board
// shows rather than a long pile of prop bundles.
import { rememberPage } from "@/lib/settings-nav";
import { useMemo } from "react";
import type { BrowserState, NewCardInput } from "@/lib/client";
import { planResets } from "@/lib/schedule";
import type { Card, RestartStatus, ThreadItem } from "@/lib/types";
import type { UseWorkspaceLayout } from "@/lib/use-workspace-layout";
import type { threadHandlers } from "@/lib/thread-handlers";
import OpenCard, { CardFrame } from "./OpenCard";
import { guarded } from "./guarded";

// Each loads in its own CrashGuard, so a broken piece breaks only its own spot.
const NewThreadWindow = guarded(() => import("./NewThreadWindow"), { what: "New thread window", inline: true });

export interface BoardFrameProps {
  // The New thread form is up; otherwise the open card's thread.
  showNew: boolean;
  // The open card, when there is one.
  selected: Card | null;
  cards: Card[];
  home: string;
  // The folder "New Thread in This Folder" asked for; otherwise the dialog picks.
  newCwd?: string;
  project: string | null;
  restart: RestartStatus | null;
  onCreate: (input: NewCardInput, opts?: { stay?: boolean }) => Promise<void>;
  onCloseNew: () => void;
  // The open card's thread: its items, its handlers and the text streaming in.
  items: ThreadItem[];
  handlers: ReturnType<typeof threadHandlers> | null;
  streaming: string;
  renameId: string | null;
  workspace: UseWorkspaceLayout;
  desktop: boolean;
  browser: BrowserState;
  obscured: boolean;
  browserWidth: number;
  onBrowserWidth: (width: number) => void;
  onStar: () => void;
  onTags: () => void;
  onShare: () => void;
  onArchive: () => void;
  onOpenSettings: () => void;
  // The frame's bottom offset, for the terminal.
  bottom: number | undefined;
  onBackdrop: () => void;
}

export default function BoardFrame(props: BoardFrameProps) {
  const { showNew, selected, cards, home, newCwd, project, restart, onCreate, onCloseNew } = props;
  // The folder the New thread form last used, so it opens where the user was.
  const recentCwd = useMemo(
    () => [...cards].sort((a, b) => b.updatedAt - a.updatedAt).find((c) => c.cwd !== home)?.cwd,
    [cards, home],
  );

  return (
    <CardFrame framed={Boolean(selected) || showNew} bottom={props.bottom} onBackdrop={props.onBackdrop}>
      {showNew ? (
        <NewThreadWindow
          form={{ cards, home, defaultCwd: newCwd ?? project ?? undefined, recentCwd, restart, onCreate, onManageAgents: () => {
            rememberPage("agents");
            props.onOpenSettings();
          } }}
          browser={{ desktop: props.desktop, state: props.browser, obscured: props.obscured, width: props.browserWidth, onWidth: props.onBrowserWidth }}
          onClose={onCloseNew}
        />
      ) : selected && props.handlers ? (
        <OpenCard
          card={selected}
          handlers={props.handlers}
          items={props.items}
          streaming={props.streaming}
          resets={planResets(cards)}
          editTitle={props.renameId === selected.id}
          workspace={props.workspace}
          browser={{ desktop: props.desktop, state: props.browser, width: props.browserWidth, onWidth: props.onBrowserWidth, obscured: props.obscured }}
          onStar={props.onStar}
          onTags={props.onTags}
          onShare={props.onShare}
          onArchive={props.onArchive}
          onOpenSettings={props.onOpenSettings}
        />
      ) : null}
    </CardFrame>
  );
}
