"use client";

import { useState } from "react";
import { shown } from "@/lib/badge-kit";
import { BADGE_GROUPS, fixFor, type Badge } from "@/lib/game-badges";
import { BRANCHES, branchProgress, CHECKS, productionReady, type CheckDef, type ProjectReport } from "@/lib/project-badges";
import Tip from "./Tip";

export type StartSetup = (project: ProjectReport, check: CheckDef) => void;

function when(at?: number) {
  return at ? new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
}

function SetUp({ project, check, onSetup }: { project: ProjectReport; check: CheckDef; onSetup: StartSetup }) {
  return (
    <Tip text={`Starts a card in ${project.name}: ${check.label}`}>
      <button
        onClick={() => onSetup(project, check)}
        className="rounded-md border border-line-strong px-1.5 py-0.5 text-[11px] text-ink hover:bg-sunken"
      >
        Set it up
      </button>
    </Tip>
  );
}

function BadgeTile({ badge, project, onSetup }: { badge: Badge; project: ProjectReport | null; onSetup: StartSetup }) {
  const fix = fixFor(badge, project);
  const earned = when(badge.at);
  return (
    <div
      className={`flex gap-2.5 rounded-lg border p-2.5 ${badge.unlocked ? "border-line bg-panel" : "border-dashed border-line bg-sunken/50"}`}
    >
      <span className={`text-[22px] leading-none ${badge.unlocked ? "" : "opacity-35 grayscale"}`}>{badge.icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`text-[12.5px] font-medium ${badge.unlocked ? "text-ink" : "text-muted"}`}>{badge.name}</span>
        <span className="text-[11.5px] text-muted">{badge.desc}</span>
        {badge.unlocked && earned && <span className="text-[11px] text-ok">Earned {earned}</span>}
        {!badge.unlocked && badge.need !== undefined && (
          <div className="flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-warn" style={{ width: `${(100 * (badge.have ?? 0)) / badge.need}%` }} />
            </div>
            <span className="text-[10.5px] tabular-nums text-muted">
              {badge.have ?? 0}/{badge.need}
            </span>
          </div>
        )}
        {fix && project && (
          <span>
            <SetUp project={project} check={fix} onSetup={onSetup} />
          </span>
        )}
      </div>
    </div>
  );
}

export function BadgesTab({ badges, project, onSetup }: { badges: Badge[]; project: ProjectReport | null; onSetup: StartSetup }) {
  return (
    <div className="flex flex-col gap-4">
      {BADGE_GROUPS.map((group) => {
        const list = badges.filter((b) => b.group === group);
        const have = list.filter((b) => b.unlocked).length;
        return (
          <section key={group} className="flex flex-col gap-2">
            <h3 className="text-[12px] font-medium uppercase tracking-wide text-muted">
              {group} <span className="normal-case tracking-normal">· {have} of {list.length}</span>
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {list.map((b) => (
                <BadgeTile key={b.id} badge={shown(b)} project={project} onSetup={onSetup} />
              ))}
            </div>
          </section>
        );
      })}
      {!project && <p className="text-[11.5px] text-muted">Open a card or pick a project to set up its code badges from here.</p>}
    </div>
  );
}

function Branch({ project, branch, onSetup }: { project: ProjectReport; branch: (typeof BRANCHES)[number]; onSetup: StartSetup }) {
  const p = branchProgress(project, branch.id);
  return (
    <section className="flex flex-col gap-1.5 rounded-lg border border-line p-3">
      <h3 className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <span>{branch.icon}</span> {branch.label}
        <span className={`ml-auto text-[11.5px] tabular-nums ${p.done === p.total ? "text-ok" : "text-muted"}`}>
          {p.done}/{p.total}
        </span>
      </h3>
      {CHECKS.filter((c) => c.branch === branch.id).map((check) => {
        const ok = !!project.ok[check.id];
        return (
          <div key={check.id} className="flex items-start gap-2 text-[12px]">
            <span className={ok ? "text-ok" : "text-muted"}>{ok ? "✓" : "○"}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={ok ? "text-ink" : "text-muted"}>{check.label}</span>
              {!ok && <span className="text-[11px] text-muted">{check.hint}</span>}
            </span>
            {!ok && <SetUp project={project} check={check} onSetup={onSetup} />}
          </div>
        );
      })}
    </section>
  );
}

// Each measured project's production-ready tree, the project in view first.
export function ProjectsTab({ projects, inView, onSetup }: { projects: ProjectReport[]; inView: string | null; onSetup: StartSetup }) {
  const [root, setRoot] = useState(inView ?? projects[0]?.root ?? null);
  const project = projects.find((p) => p.root === root) ?? projects[0];
  if (!project) return <p className="text-[12.5px] text-muted">Measuring your projects…</p>;
  const ready = productionReady(project);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {projects.map((p) => (
          <button
            key={p.root}
            onClick={() => setRoot(p.root)}
            className={`rounded-md border px-2 py-1 text-[12px] ${p.root === project.root ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-sunken"}`}
          >
            {p.name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <span className={ready ? "text-ok" : ""}>{ready ? "🚀 Production-ready" : "Complete all five branches for 🚀 Production-ready"}</span>
        <span>· quality {project.score ?? "n/a"}%</span>
        {project.coverage !== null && <span>· {Math.round(project.coverage)}% lines covered</span>}
        {project.stack.map((t) => (
          <span key={t} className="rounded bg-sunken px-1.5 py-0.5 text-[11px]">
            {t}
          </span>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {BRANCHES.map((b) => (
          <Branch key={b.id} project={project} branch={b} onSetup={onSetup} />
        ))}
      </div>
    </div>
  );
}
