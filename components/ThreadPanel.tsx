"use client";

import { useState, type ReactNode } from "react";
import { folderName, isLive } from "@/lib/format";
import type { PlanResets } from "@/lib/schedule";
import { useThreadTransport } from "@/lib/thread-transport";
import type { Card, PermissionMode, QuestionReply, ThreadItem } from "@/lib/types";
import BackendBadge from "./BackendBadge";
import { BackendPicker } from "./CardView";
import CardActions from "./CardActions";
import CrashGuard from "./CrashGuard";
import SkillsChip from "./SkillsChip";
import { guarded } from "./guarded";
import Icon from "./Icon";
import EditorToggle from "./EditorToggle";
import ModePicker from "./ModePicker";
import TagPill from "./TagPill";
import { cardTags } from "@/lib/rail-view";
import ThreadView from "./ThreadView";
import CopilotEmpty from "./CopilotEmpty";

// Loaded in its own CrashGuard (components/guarded.tsx), so a broken review panel leaves the thread and its reply box.
//
// The same panel opens a card on weft.zip, inside a transport that isn't the desktop's (lib/thread-transport.ts):
// there the title, CLI and mode are read-only and the card's own actions (skills, star, archive, delete, the review
// panel, Send later) stay on the Mac, so the callbacks for them are left out.
// The header's ⏰: put the thread on a cron (docs/architecture/crons.md).
const ThreadCronButton = guarded(() => import("./ThreadCronButton"), { what: "cron button" });
const ReviewPanel = guarded(() => import("./ReviewPanel"), { what: "review panel", className: "mx-4 my-2" });

export default function ThreadPanel({
  card,
  items,
  streaming,
  onSend,
  onAnswer,
  onRelease,
  onArchive,
  onStar,
  onTags,
  onShare,
  marksInPane,
  onDelete,
  onClose,
  onRename,
  onMode,
  onNewChat,
  editorOpen,
  onEditor,
  editTitle = false,
  resets,
  footer,
  readOnly = false,
  className = "",
  onOpenSettings,
  onDeleted,
}: {
  card: Card;
  items: ThreadItem[];
  streaming: string;
  onSend: (text: string) => Promise<void>;
  onAnswer: (allow: boolean, answers?: Record<string, string>, reply?: QuestionReply) => unknown;
  onRelease?: () => void;
  onArchive?: () => void;
  // The ☆: star or unstar the card.
  onStar?: () => void;
  // A click on the card's tags (or "+ tag"): opens the Tags… dialog.
  onTags?: () => void;
  // Share… beside the ☆ (the card menu has it too).
  onShare?: () => void;
  // The browser pane beside the thread shows share, star and archive in its toolbar instead.
  marksInPane?: boolean;
  onDelete?: () => void;
  // Left out while the browser shows beside the thread: the window's X sits in the browser's corner.
  onClose?: () => void;
  onRename?: (title: string) => void;
  // Applies to the open CLI right away, mid-turn included.
  onMode?: (mode: PermissionMode) => void;
  // The copilot's New chat, in place of the board card's skills, star, archive and delete.
  onNewChat?: () => void;
  // The ✏︎ beside the X: opens or closes the editor column (CardWorkspace draws no strip for it).
  editorOpen?: boolean;
  onEditor?: () => void;
  // Opens with the title already being edited (Rename… in the card's right-click menu).
  editTitle?: boolean;
  // The plan's next 5-hour and weekly resets, the reply box's default Send later times.
  resets?: PlanResets;
  // Above the reply box, in place of the review panel (weft.zip: the replies still on their way to the Mac).
  footer?: ReactNode;
  // Nothing can be sent from here (weft.zip, a teammate's card): no reply box, no answers.
  readOnly?: boolean;
  // Replaces the default sizing classes when the panel is rendered as a column inside CardWorkspace.
  className?: string;
  // Board-side Settings opener. Threaded into ThreadView so the first-message-error banner can offer
  // "Pick a backup model" by jumping to Settings → Models.
  onOpenSettings?: () => void;
  // After the first-message-error banner deletes the card, the board closes the thread.
  onDeleted?: () => void;
}) {
  const live = isLive(card);
  // The copilot opens here like any card, but it has no project and isn't filed, starred or renamed.
  const pilot = card.role === "copilot";
  const { desktop } = useThreadTransport();

  return (
    <aside data-drop-target={card.id} className={className || "flex w-[44%] min-w-[380px] shrink-0 flex-col bg-panel last:flex-1"}>
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <PanelTitle card={card} editable={!pilot && desktop} editTitle={editTitle} onRename={onRename} />
          <HeaderMeta card={card} pilot={pilot} desktop={desktop} onMode={onMode} onTags={onTags} />
          {(card.stage || card.remaining) && (
            <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11.5px]">
              {card.stage && <span className="shrink-0 rounded bg-sunken px-1.5 py-px text-muted">{card.stage}</span>}
              {card.remaining && <span className="truncate text-faint" title={card.remaining}>Left: {card.remaining}</span>}
            </div>
          )}
        </div>
        {pilot ? (
          <NewChatButton onClick={onNewChat} />
        ) : (
          desktop && onArchive && onDelete && (
            <CardActions card={card} live={live} onSend={onSend} onShare={onShare} onStar={onStar} onArchive={onArchive} onDelete={onDelete} marksInPane={marksInPane} />
          )
        )}
        <ThreadCronButton card={card} items={items} />
        <EditorToggle open={editorOpen} onClick={onEditor} />
        {onClose && (
          <button
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close thread"
            className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink"
          >
            <Icon name="x" size={15} />
          </button>
        )}
      </header>

      <ClaudeCodeNote card={card} onRelease={onRelease} />

      <ThreadView
        card={card}
        items={items}
        streaming={streaming}
        onSend={onSend}
        onAnswer={onAnswer}
        readOnly={readOnly}
        onOpenSettings={onOpenSettings}
        onDeleted={onDeleted}
        {...threadExtras(card, pilot, items, onSend, desktop ? resets : undefined, footer)}
      />
    </aside>
  );
}

// A thread picked up from Claude Code: it continues the same session, unless a CLI elsewhere has it open right now
// (then "Click here to continue" stops that CLI, where the panel can: onRelease).
function ClaudeCodeNote({ card, onRelease }: { card: Card; onRelease?: () => void }) {
  if (card.source !== "claude-code") return null;
  if (!card.openElsewhere)
    return <p className="border-b border-line px-4 py-1.5 text-[11.5px] text-muted">Picked up from Claude Code. Replying here continues the same session.</p>;
  return (
    <p className="flex items-center gap-1.5 border-b border-warn/40 bg-warn-soft px-4 py-1.5 text-[11.5px] text-warn">
      <Icon name="alert" size={12} />
      <span className="min-w-0 flex-1">Open in the Claude app or a terminal right now.</span>
      {onRelease && (
        <button
          onClick={onRelease}
          title="Stop the Claude CLI that has this thread open, so replies continue here"
          className="shrink-0 rounded px-1.5 py-0.5 font-medium underline underline-offset-2 hover:bg-warn/15"
        >
          Click here to continue
        </button>
      )}
    </p>
  );
}

// The thread's title; a click renames it (not the copilot's), Enter keeps the new name and Escape drops it.
function PanelTitle({ card, editable, editTitle, onRename }: {
  card: Card;
  editable: boolean;
  editTitle: boolean;
  onRename?: (title: string) => void;
}) {
  const [editing, setEditing] = useState(editTitle);
  if (editing && editable) {
    return (
      <input
        autoFocus
        defaultValue={card.title}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            // Cancels the rename only; the thread stays open.
            e.stopPropagation();
            e.currentTarget.value = card.title;
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => {
          const title = e.currentTarget.value.trim();
          setEditing(false);
          if (title && title !== card.title) onRename?.(title);
        }}
        className="w-full rounded border border-accent bg-panel px-1 py-0.5 text-[14px] font-medium leading-snug text-ink outline-none"
      />
    );
  }
  return (
    <h2
      title={editable ? "Click to rename" : undefined}
      onClick={() => setEditing(editable)}
      className={`line-clamp-2 rounded text-[14px] font-medium leading-snug text-ink ${editable ? "cursor-text hover:bg-sunken" : ""}`}
    >
      {card.title}
    </h2>
  );
}

// Under the title: the CLI, its mode, the folder (the copilot covers the whole board), the session and its tags.
// Off the desktop, the CLI is a badge and the mode stays the Mac's.
function HeaderMeta({ card, pilot, desktop, onMode, onTags }: {
  card: Card;
  pilot: boolean;
  desktop: boolean;
  onMode?: (mode: PermissionMode) => void;
  onTags?: () => void;
}) {
  return (
    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
      {desktop ? <BackendPicker card={card} /> : <BackendBadge backend={card.backend} card={card} />}
      {desktop && onMode && (
        <CrashGuard inline what="mode picker"><ModePicker small backend={card.backend} value={card.permissionMode} onChange={onMode} yolo={card.backend !== "puku" && !pilot} disabled={card.backend === "codex" && Boolean(card.sessionId)} /></CrashGuard>
      )}
      {desktop && !pilot && <CrashGuard inline what="skills"><SkillsChip card={card} /></CrashGuard>}
      <span className="min-w-[3rem] truncate" title={card.cwd}>{pilot ? "✨ whole board" : folderName(card.cwd)}</span>
      {card.sessionId && (
        <span className="shrink-0 whitespace-nowrap font-mono text-faint" title={card.sessionId}>· {card.sessionId.slice(0, 8)}</span>
      )}
      {card.warm && (
        <span className="shrink-0 whitespace-nowrap text-ok" title="The CLI is open, so a reply starts right away">· live</span>
      )}
      <HeaderMarks card={card} readOnly={!desktop} onTags={pilot ? undefined : onTags} />
    </div>
  );
}

// What the thread shows that differs for the copilot: no review panel or Send later, a few suggestions to start.
// Without resets (off the desktop) there's no Send later or review panel either; the caller's footer shows instead.
function threadExtras(card: Card, pilot: boolean, items: ThreadItem[], onSend: (text: string) => Promise<void>, resets: PlanResets | undefined, footer: ReactNode) {
  if (pilot) {
    return {
      empty: <CopilotEmpty onAsk={(text) => void onSend(text).catch(() => {})} />,
      placeholder: "Ask about your threads, or tell me what to start",
    };
  }
  if (!resets) return { footer };
  return {
    footer: card.column === "review" && <ReviewPanel card={card} items={items} onSend={onSend} />,
    replaceReply: card.column === "review" && Boolean(card.review),
    scheduling: { resets },
  };
}

// Starts the copilot over with an empty conversation.
function NewChatButton({ onClick }: { onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Start a new conversation"
      className="shrink-0 rounded-md px-2 py-1 text-[11.5px] text-muted hover:bg-sunken hover:text-ink"
    >
      New chat
    </button>
  );
}

// The card's GitHub issue (#N, a link) and its tags, which open the Tags… dialog ("+ tag" with none yet); read-only
// (weft.zip), just the tags.
function HeaderMarks({ card, readOnly, onTags }: { card: Card; readOnly: boolean; onTags?: () => void }) {
  return (
    <>
      {card.issue && (
        <a href={card.issue.url} target="_blank" rel="noreferrer" title={`${card.issue.repo}#${card.issue.number} (${card.issue.state})`} className="shrink-0 font-medium text-muted hover:underline">
          #{card.issue.number}
        </a>
      )}
      {readOnly && card.tags?.length ? <HeaderTags tags={card.tags} /> : null}
      {onTags && !readOnly && (
        <button
          type="button"
          onClick={onTags}
          title="Edit tags"
          aria-label={card.tags?.length ? `Tags: ${card.tags.join(", ")}` : "Add a tag"}
          className="flex shrink-0 items-center gap-1 rounded px-0.5 hover:bg-sunken"
        >
          {card.tags?.length ? <HeaderTags tags={card.tags} /> : <span className="whitespace-nowrap text-faint">+ tag</span>}
        </button>
      )}
    </>
  );
}

// Up to three tags, then "+N".
function HeaderTags({ tags }: { tags: string[] }) {
  const { shown, more } = cardTags(tags, 3);
  return (
    <>
      {shown.map((tag) => (
        <TagPill key={tag} tag={tag} className="max-w-[80px]" />
      ))}
      {more > 0 && <span className="text-faint">+{more}</span>}
    </>
  );
}
