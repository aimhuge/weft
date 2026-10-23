"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { fixPrompt, tone, type QualityReport, type Section } from "@/lib/quality-view";
import { findingPrompt, findingTitle, headroomScore, openFindings, scoreNote, scoreParts, type ScoutState } from "@/lib/scout-view";
import { folderName, timeAgo } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { useScout } from "@/lib/use-scout";
import ScoutDialog from "./ScoutDialog";
import Tip from "./Tip";

const R = 6;
const C = 2 * Math.PI * R;

function Pie({ pct }: { pct: number }) {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" className="-rotate-90">
      <circle cx={8} cy={8} r={R} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={4} />
      <circle cx={8} cy={8} r={R} fill="none" stroke="currentColor" strokeWidth={4} strokeDasharray={`${(C * pct) / 100} ${C}`} />
    </svg>
  );
}

function Row({ s }: { s: Section }) {
  const failing = s.checks.filter((c) => !c.ok);
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex items-center gap-2">
        <span className="w-[86px]">{s.name}</span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
          {s.score !== null && <span className={`block h-full rounded-full bg-current ${tone(s.score)}`} style={{ width: `${s.score}%` }} />}
        </span>
        <span className={`w-[34px] text-right tabular-nums ${s.score === null ? "text-muted" : tone(s.score)}`}>
          {s.score === null ? "n/a" : `${s.score}%`}
        </span>
      </span>
      <span className="text-muted">{s.summary}</span>
      {failing.map((c) => (
        <span key={c.label} className="text-muted">
          <span className="text-danger">✗</span> {c.label}
        </span>
      ))}
      {s.longFiles?.slice(0, 3).map((f) => (
        <span key={f.path} className="flex gap-2 text-muted">
          <span className="min-w-0 flex-1 truncate">{f.path}</span>
          <span className="tabular-nums">{f.lines}</span>
        </span>
      ))}
    </span>
  );
}

function Breakdown({ q, scout }: { q: QualityReport; scout: ScoutState | null }) {
  const now = useNow();
  const report = scout?.report ?? null;
  const open = openFindings(report);
  const parts = scoreParts(q.score, report);
  return (
    <span className="flex w-[236px] flex-col gap-2">
      <span>
        <b>Code quality</b> of <b>{folderName(q.root)}</b>: <b>{headroomScore(q.score, report)}%</b>
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="flex justify-between">
          <span>Checklist</span>
          <span className="tabular-nums">{parts.checklist} of 90</span>
        </span>
        <span className="flex justify-between">
          <span>Refactor scout{report ? `, ${String(open.length)} open` : ""}</span>
          <span className="tabular-nums">{parts.scout} of 10</span>
        </span>
        <span className="text-muted">{scoreNote(report)}</span>
      </span>
      <span>The checklist, {q.score}%, averages:</span>
      {q.sections.map((s) => (
        <Row key={s.key} s={s} />
      ))}
      {open.length > 0 && (
        <span className="flex flex-col gap-0.5">
          <span>Top findings:</span>
          {open.slice(0, 3).map((f) => (
            <span key={f.id} className="truncate text-muted">
              {f.smell} · {f.file}:{f.line}
            </span>
          ))}
        </span>
      )}
      <span className="text-muted">
        {q.coverageAt ? `Coverage measured ${timeAgo(q.coverageAt, now)}. ` : ""}
        {scout?.running ? "The scout is reading the code. " : ""}
        Click to see the suggestions and start a card for one.
      </span>
    </span>
  );
}

// "74% code quality" with a pie, for the project in view (the open card's folder, else the selected
// project). Never 100: the checklist earns 90 and the refactor scout's open findings (lib/scout-view.ts) the
// last 10. Hover for how; click for a dialog that starts a card per finding, or one that fixes the checklist.
export default function QualityBadge({
  cwd,
  onImprove,
}: {
  cwd?: string | null;
  onImprove: (cwd: string, prompt: string, title: string) => void;
}) {
  // Keyed by folder, so switching projects never shows the last one's numbers.
  const [loaded, setLoaded] = useState<{ cwd: string; q: QualityReport | null } | null>(null);
  // Folders a fix thread was started for this session, so one click can't start two.
  const [started, setStarted] = useState<string[]>([]);
  const [menu, setMenu] = useState(false);
  const { scout, rescout, started: markStarted } = useScout(cwd);

  useEffect(() => {
    if (!cwd) return;
    let live = true;
    // Re-read on focus too, so a fresh `npm run coverage` or a split file shows up without a reload.
    const load = () => {
      apiFetch(`/api/quality?cwd=${encodeURIComponent(cwd)}`)
        .then((r) => r.json() as Promise<{ quality: QualityReport | null }>)
        .then((d) => {
          if (live) setLoaded({ cwd, q: d.quality });
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      live = false;
      window.removeEventListener("focus", load);
    };
  }, [cwd]);

  if (!cwd || !loaded || loaded.cwd !== cwd || !loaded.q) return null;
  const q = loaded.q;
  const busy = started.includes(cwd);
  const score = headroomScore(q.score, scout?.report ?? null);
  const close = () => setMenu(false);

  return (
    <>
      <Tip text={<Breakdown q={q} scout={scout} />}>
        <button
          onClick={() => setMenu(!menu)}
          aria-haspopup="dialog"
          className={`flex items-center gap-1 rounded-md px-1 py-0.5 text-[12px] hover:bg-sunken ${tone(score)}`}
        >
          <Pie pct={score} />
          {score}%<span className="text-muted">{busy ? "improving…" : scout?.running ? "scouting…" : "code quality"}</span>
        </button>
      </Tip>
      {menu && (
        <ScoutDialog
          title={`Code quality · ${folderName(cwd)} · ${String(score)}%`}
          scout={scout}
          checklistDone={busy || q.score >= 100}
          onClose={close}
          onFixChecklist={() => {
            close();
            setStarted((s) => [...s, cwd]);
            onImprove(cwd, fixPrompt(q), "Improve code quality");
          }}
          onStart={(f) => {
            close();
            markStarted(f.id);
            onImprove(cwd, findingPrompt(f), findingTitle(f));
          }}
          onRescout={rescout}
        />
      )}
    </>
  );
}
