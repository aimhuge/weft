"use client";

import { useState } from "react";
import { useFindReveal } from "@/lib/find-reveal";
import { describeToolRun, shortToolName, toolAction } from "@/lib/format";
import type { ThreadItem } from "@/lib/types";
import Icon, { Spinner } from "./Icon";
import MediaView from "./MediaView";
import ToolLine from "./ToolLine";

type ToolCall = Extract<ThreadItem, { kind: "tool" }>;
type Permission = Extract<ThreadItem, { kind: "permission" }>;

// A run of tool calls as one line, "Ran 3 commands, read 2 files, edited a file +1", that opens to
// show each call. Screenshots the run took stay visible while it's folded.
export default function ToolRun({ calls, live, cardId }: { calls: (ToolCall | Permission)[]; live: boolean; cardId: string }) {
  const [opened, setOpen] = useState(false);
  // Find in the thread opens the run while its match is the current one (lib/find-reveal.ts).
  const open = useFindReveal(calls) || opened;
  const tools = calls.filter((c): c is ToolCall => c.kind === "tool");
  if (!tools.length) return calls.map((c, i) => <PermissionRow key={i} item={c as Permission} />);

  const { text, more } = describeToolRun(tools.map((t) => ({ action: t.action ?? toolAction(t.name), target: t.summary })));
  const running = live ? tools.find((t) => t.result === undefined && t.resultBytes === undefined) : undefined;
  const failed = tools.filter((t) => t.isError).length;
  const denied = calls.filter((c) => c.kind === "permission" && c.decision === "deny").length;
  const waiting = calls.some((c) => c.kind === "permission" && !c.decision);
  const images = [...new Set(tools.flatMap((t) => t.images ?? []))];

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex max-w-full items-center gap-1.5 text-left text-[12.5px] text-muted hover:text-ink"
      >
        {running && <Spinner size={10} />}
        <span className="truncate">
          {text}
          {more > 0 && <span className="text-faint"> +{more}</span>}
        </span>
        {failed > 0 && <span className="shrink-0 text-danger">· {failed} failed</span>}
        {denied > 0 && <span className="shrink-0 text-danger">· {denied} denied</span>}
        {waiting && <span className="shrink-0 text-warn">· waiting for you</span>}
        <Icon name="chevronRight" size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {running && !open && (
        <div className="mt-0.5 truncate pl-4 font-mono text-[11.5px] text-faint">
          {shortToolName(running.name)} {running.summary}
        </div>
      )}
      {open ? (
        <div className="mt-2 flex flex-col gap-1.5 border-l-2 border-line pl-3">
          {calls.map((c, i) =>
            c.kind === "tool" ? <ToolLine key={c.id || i} item={c} live={live} cardId={cardId} /> : <PermissionRow key={i} item={c} />,
          )}
        </div>
      ) : (
        images.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {images.map((src) => (
              <MediaView key={src} src={src} alt="Screenshot" thumb={images.length > 1} />
            ))}
          </div>
        )
      )}
    </div>
  );
}

// An answer can run long (one per question), so it goes under the title instead of squeezing it.
function PermissionRow({ item }: { item: Permission }) {
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
