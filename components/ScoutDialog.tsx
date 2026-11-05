"use client";

import { timeAgo } from "@/lib/format";
import { openFindings, type Finding, type ScoutState, type Severity } from "@/lib/scout-view";
import { useFeatureIntro } from "@/lib/use-feature-intro";
import { useNow } from "@/lib/use-now";
import { IntroButton, IntroFrame } from "./FeatureIntro";
import Modal from "./Modal";

const DOT: Record<Severity, string> = { high: "bg-danger", medium: "bg-warn", low: "bg-muted" };

// The quality badge's dialog: fix the checklist, or start one of the scout's findings as its own small card.
// The chrome (backdrop, header, ✕, Escape, hiding the browser pane) is the shared Modal.
export default function ScoutDialog({
  title,
  scout,
  checklistDone,
  onClose,
  onFixChecklist,
  onStart,
  onRescout,
}: {
  title: string;
  scout: ScoutState | null;
  checklistDone: boolean;
  onClose: () => void;
  onFixChecklist: () => void;
  onStart: (f: Finding) => void;
  onRescout: () => void;
}) {
  const now = useNow();
  const intro = useFeatureIntro("quality");

  const report = scout?.report ?? null;
  const open = openFindings(report);
  const row = "flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent-soft disabled:opacity-40 disabled:hover:bg-transparent";
  const status = scout?.running
    ? "Scouting the code… (a few minutes)"
    : scout?.error
      ? `Last run failed: ${scout.error}`
      : report
        ? `${String(open.length)} open · ran ${timeAgo(report.ranAt, now)}${report.commit ? ` on ${report.commit.slice(0, 7)}` : ""}`
        : "Not scouted yet";

  return (
    <Modal title={<span className="flex items-center gap-1.5">{title}<IntroButton intro={intro} /></span>} label={title} onClose={onClose} placement="top" className="max-h-[76vh] w-full max-w-[560px] text-[12.5px]">
      <div className="flex min-h-0 flex-1 flex-col p-1.5">
        <IntroFrame intro={intro} className="mb-1.5" />
        <button className={row} disabled={checklistDone} onClick={onFixChecklist}>
          <span className="flex-1 font-medium text-ink">Fix the checklist, weakest first</span>
        </button>
        <div className="my-1 border-t border-line" />
        <p className="px-2.5 pb-1 text-[11px] text-faint">Refactor scout · {status}{open.length ? ". Click one to start it as a card." : ""}</p>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {open.map((f) => (
            <button key={f.id} className={row} onClick={() => onStart(f)}>
              <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${DOT[f.severity]}`} title={f.severity} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex gap-1.5">
                  <span className="shrink-0 font-medium text-ink">{f.smell}</span>
                  <span className="min-w-0 truncate font-mono text-[11px] leading-[18px] text-muted">
                    {f.file}:{f.line}
                  </span>
                </span>
                <span className="text-[11.5px] text-muted">{f.fix}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="my-1 border-t border-line" />
        <button className={row} disabled={scout?.running} onClick={onRescout}>
          <span className="flex-1 text-ink">{scout?.running ? "Scouting…" : "Re-scout now"}</span>
        </button>
      </div>
    </Modal>
  );
}
