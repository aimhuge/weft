"use client";

// A subagent under an opened card in the list view: what it was asked to do, how it's going, what it
// last did, its type and how long ago it started, in the same cells as a card's row so it lines up.
import type { CardTask, TaskStatus } from "@/lib/tasks";
import { LIST_GRID } from "./list-grid";
import { Spinner } from "./Icon";
import { AgeCell } from "./CardRowCells";

const STATUS: Record<TaskStatus, { word: string; tone: string; mark: string }> = {
  running: { word: "Running", tone: "text-accent", mark: "" },
  completed: { word: "Done", tone: "text-ok", mark: "✓" },
  failed: { word: "Failed", tone: "text-danger", mark: "✕" },
  stopped: { word: "Stopped", tone: "text-muted", mark: "■" },
  ended: { word: "Ended", tone: "text-faint", mark: "·" },
  lost: { word: "Cut off", tone: "text-warn", mark: "!" },
};

export default function AgentRow({ task, depth, now }: { task: CardTask; depth: number; now: number }) {
  const status = STATUS[task.status];
  const doing = task.status === "running" ? task.lastTool ?? task.summary : task.summary;
  return (
    <div className="sheet-agent-row flex items-stretch" data-agent-row>
      <div className={`${LIST_GRID} w-full`}>
        <span className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 18 }}>
          <span className="sheet-branch" aria-hidden />
          <span className="sheet-agent-badge" aria-hidden>
            ✦
          </span>
          <span className="min-w-0 truncate text-[12px] text-muted" title={task.description}>
            {task.description}
          </span>
        </span>
        <span className={`gap-1.5 text-[11px] ${status.tone}`}>
          {task.status === "running" ? <Spinner size={10} /> : <span aria-hidden>{status.mark}</span>}
          <span className="truncate">{status.word}</span>
        </span>
        <span className="text-[11px] text-faint">
          <span className="truncate" title={doing}>
            {doing ?? ""}
          </span>
        </span>
        <span className="text-[11px] text-faint">
          <span className="sheet-agent-type truncate">{task.subagentType ?? "agent"}</span>
        </span>
        <span className="text-[11px] tabular-nums text-faint">{task.toolUses ? `${task.toolUses} tools` : ""}</span>
        <AgeCell at={task.startedAt} now={now} />
        <span />
      </div>
    </div>
  );
}
