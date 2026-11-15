"use client";

import { useState } from "react";
import { useFindReveal } from "@/lib/find-reveal";
import { shortToolName } from "@/lib/format";
import { turnId } from "@/lib/show-rail";
import { turnSteps, type ToolsEntry } from "@/lib/turn-steps";
import Icon, { Spinner } from "./Icon";
import ToolRun, { Screenshots } from "./ToolRun";

// Simple mode's folded turn (lib/turn-steps.ts): every tool run in one agent turn as a single line,
// "Weft ran 14 steps", that opens to show the runs as they are without it. Screenshots stay visible.
export default function TurnSteps({ runs, live, cardId }: { runs: ToolsEntry[]; live: boolean; cardId: string }) {
  const [opened, setOpen] = useState(false);
  // Find in the thread opens the line while its match is in one of the runs (lib/find-reveal.ts).
  const open = useFindReveal(runs.flatMap((run) => run.calls)) || opened;
  const { label, summary, failed, denied, running, images } = turnSteps(runs, live);

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={summary}
        className="flex max-w-full items-center gap-1.5 text-left text-[12.5px] text-muted hover:text-ink"
      >
        {running && <Spinner size={10} />}
        <span className="truncate">{label}</span>
        {failed > 0 && <span className="shrink-0 text-danger">· {failed} failed</span>}
        {denied > 0 && <span className="shrink-0 text-danger">· {denied} denied</span>}
        <Icon name="chevronRight" size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {running && !open && (
        <div className="mt-0.5 truncate pl-4 font-mono text-[11.5px] text-faint">
          {shortToolName(running.name)} {running.summary}
        </div>
      )}
      {open ? (
        <div className="mt-2 flex flex-col gap-2 border-l-2 border-line pl-3">
          {/* Each run past the first keeps its own data-turn, so find can land on its row once this opens
              (the first run's key is this line's own row, in components/ThreadItems.tsx). */}
          {runs.map((run, i) => (
            <div key={run.key} data-turn={i ? turnId(run.key) : undefined}>
              <ToolRun calls={run.calls} live={live} cardId={cardId} />
            </div>
          ))}
        </div>
      ) : (
        <Screenshots images={images} />
      )}
    </div>
  );
}
