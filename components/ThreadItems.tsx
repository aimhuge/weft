"use client";

import { memo, useState } from "react";
import { formatTokens } from "@/lib/format";
import { turnId } from "@/lib/show-rail";
import type { ThreadItem } from "@/lib/types";
import CrashGuard from "./CrashGuard";
import Icon from "./Icon";
import Markdown from "./Markdown";
import RepeatFromHere from "./RepeatFromHere";
import { SecretAskBatchProvider } from "./SecretAskBatch";
import SecretAskInput from "./SecretAskInput";
import ShellLine from "./ShellLine";
import ToolLine from "./ToolLine";
import ToolRun from "./ToolRun";

type ToolCall = Extract<ThreadItem, { kind: "tool" }>;
type Permission = Extract<ThreadItem, { kind: "permission" }>;

// What a thread shows: a message, or a run of tool calls between messages, folded into one line. key is
// the index of the first thread item in it, so it stays put as the run grows.
export type Entry = { kind: "item"; item: ThreadItem; key: number } | { kind: "tools"; calls: (ToolCall | Permission)[]; key: number };

// Tool calls, and the permission requests they made, fold together. An answered question stays out. A
// stored thread can hold a null hole, so items are checked one by one; a thread's ask for a key stays
// out too: it's an input the user fills in (SecretAskInput).
export function groupThread(items: readonly (ThreadItem | null | undefined)[]): Entry[] {
  const entries: Entry[] = [];
  items.forEach((item, key) => {
    if (!item) return;
    const folds = (item.kind === "tool" && !item.ask) || (item.kind === "permission" && !item.answer);
    const last = entries[entries.length - 1];
    if (!folds) entries.push({ kind: "item", item, key });
    else if (last?.kind === "tools") last.calls.push(item);
    else entries.push({ kind: "tools", calls: [item], key });
  });
  return entries;
}

// An answer can run long (one per question), so it goes under the title instead of squeezing it.
function PermissionLine({ item }: { item: Permission }) {
  const decisionColor = item.decision === "allow" ? "text-ok" : item.decision === "deny" ? "text-danger" : "text-warn";
  return (
    <div className={`flex text-[12px] ${item.answer ? "flex-col gap-1" : "items-start gap-2"}`}>
      <span className="flex min-w-0 flex-1 items-start gap-2">
        <Icon name="lock" size={12} className={`mt-0.5 shrink-0 ${item.decision ? "text-faint" : "text-warn"}`} />
        <span className="min-w-0 flex-1 text-muted">{item.title}</span>
      </span>
      <span className={`${item.answer ? "pl-5" : "shrink-0"} ${decisionColor}`}>
        {item.answer ? `Answered: ${item.answer}` : item.decision === "allow" ? "Allowed" : item.decision === "deny" ? "Denied" : "Waiting for you"}
      </span>
    </div>
  );
}

// A message you edited with ↑ and the turn it started, folded to one line you can open.
function EditedFold({ items, cardId }: { items: ThreadItem[]; cardId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-[11.5px] text-faint">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 hover:text-muted"
      >
        <Icon name={open ? "chevronDown" : "chevronRight"} size={11} />
        Edited · {open ? "hide" : "show"} the version you replaced
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-3 border-l border-line pl-3 opacity-60">
          {groupThread(items).map((entry) =>
            entry.kind === "tools" ? (
              <ToolRun key={entry.key} calls={entry.calls} live={false} cardId={cardId} />
            ) : (
              <ThreadMessage key={entry.key} item={entry.item} cardId={cardId} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

// One message or marker in a thread. Items don't change once written, so a re-render while the
// agent streams skips them.
export const ThreadMessage = memo(function ThreadMessage({ item, cardId }: { item: ThreadItem; cardId: string }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="group relative ml-10 rounded-lg bg-accent-soft px-3 py-2">
          <RepeatFromHere cardId={cardId} id={item.id} text={item.text} />
          <Markdown text={item.text} />
          {item.midTurn && <p className="mt-1 text-[11px] text-muted">Sent mid-turn · read after the next tool call</p>}
        </div>
      );
    case "assistant":
      return <Markdown text={item.text} />;
    case "tool":
      return <ToolLine item={item} live={false} cardId={cardId} />;
    case "permission":
      return <PermissionLine item={item} />;
    case "result":
      return (
        <div className="flex items-center gap-2 py-1 text-[11px] text-faint">
          <div className="h-px flex-1 bg-line" />
          {item.isError ? (
            <span className="text-danger">{item.text}</span>
          ) : (
            <span>{item.text === "Stopped" ? "Stopped" : "Turn finished"}</span>
          )}
          <div className="h-px flex-1 bg-line" />
        </div>
      );
    case "edited":
      return <EditedFold items={item.items} cardId={cardId} />;
    case "shell":
      return <ShellLine item={item} />;
    case "notification":
      return <NotificationLine item={item} />;
    case "spliced":
      return <SplicedLine item={item} />;
  }
});

// Where a cold card's fresh session begins (lib/splice.ts): a divider you can open to read the brief it started from.
function SplicedLine({ item }: { item: Extract<ThreadItem, { kind: "spliced" }> }) {
  const [open, setOpen] = useState(false);
  const saved = item.tokens ? ` · ${formatTokens(item.tokens)} not re-sent` : "";
  return (
    <div className="text-[11px] text-faint">
      <div className="flex items-center gap-2 py-1">
        <div className="h-px flex-1 bg-line" />
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1 hover:text-muted">
          <Icon name={open ? "chevronDown" : "chevronRight"} size={11} />
          Fresh session{saved} · {open ? "hide" : "show"} the brief
        </button>
        <div className="h-px flex-1 bg-line" />
      </div>
      {open && (
        <div className="mt-1 border-l border-line pl-3 text-[12px] text-muted">
          <Markdown text={item.brief.replace(/<\/?system-reminder>/g, "").trim()} />
        </div>
      )}
    </div>
  );
}

// A background task the CLI told the agent had ended, as the <task-notification> it sent: often what
// started the turn below it.
function NotificationLine({ item }: { item: Extract<ThreadItem, { kind: "notification" }> }) {
  const color = item.status === "failed" ? "text-danger" : item.status === "stopped" ? "text-warn" : "text-muted";
  return (
    <div className="flex items-start gap-2 rounded-lg border border-line bg-sunken px-2.5 py-1.5 text-[12px]">
      <Icon name="clock" size={12} className="mt-0.5 shrink-0 text-faint" />
      <code className="shrink-0 font-mono text-[11.5px] text-faint">&lt;task-notification&gt;</code>
      <span className={`min-w-0 flex-1 ${color}`}>{item.summary}</span>
    </div>
  );
}

// A "!" command you ran from the reply box (lib/shell.ts). The row is in components/ShellLine.tsx.
// A thread's messages and tool runs, then the reply streaming in. While ↑ edits a message (editFrom is
// its index), that message is outlined and the turn it will replace, everything after it, fades. onSend lets
// the keys the thread asked for tell it once they're all in the vault (one message for the lot).
export function ThreadEntries({
  entries,
  live,
  streaming,
  editFrom,
  onSend,
  cardId,
}: {
  entries: Entry[];
  live: boolean;
  streaming: string;
  editFrom?: number;
  onSend?: (text: string) => Promise<void>;
  // The card whose thread is being drawn: threaded down to a tool row so it can lazy-fetch the
  // full result when its inline result was trimmed (lib/cloud-sync-types.ts).
  cardId: string;
}) {
  return (
    <SecretAskBatchProvider onSend={onSend}>
      {entries.map((entry) => {
        // One message that fails to draw is a chip in its place; the rest of the thread and the reply box stay.
        const row = (
          <CrashGuard key={entry.key} inline what={entry.kind === "tools" ? "tool run" : "message"} className="self-start">
            {entry.kind === "tools" ? (
              <ToolRun calls={entry.calls} live={live} cardId={cardId} />
            ) : entry.item.kind === "tool" && entry.item.ask ? (
              <SecretAskInput ask={entry.item.ask} onAdded={onSend} />
            ) : (
              <ThreadMessage item={entry.item} cardId={cardId} />
            )}
          </CrashGuard>
        );
        // data-turn ties the row to its mini in the show rail (lib/show-rail.ts).
        const mark =
          editFrom === undefined || entry.key < editFrom
            ? ""
            : entry.key === editFrom
              ? " outline-1 outline-offset-2 outline-warn outline-dashed"
              : " opacity-40";
        return (
          <div key={entry.key} data-turn={turnId(entry.key)} className={`flex flex-col gap-3 rounded-lg${mark}`}>
            {row}
          </div>
        );
      })}
      {streaming && (
        <div className={editFrom === undefined ? undefined : "opacity-40"}>
          <CrashGuard inline what="reply in progress">
            <Markdown text={streaming} streaming />
          </CrashGuard>
        </div>
      )}
    </SecretAskBatchProvider>
  );
}
