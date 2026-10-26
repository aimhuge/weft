"use client";

import { useState } from "react";
import { folderName } from "@/lib/format";
import { skillsOffCount } from "@/lib/skill-set-view";
import { useSkillSet } from "@/lib/use-skill-set";
import SkillSetList from "./SkillSetList";

// ✦ in the left rail: the board's project's default skill set, the skills and plugins every new thread there
// gets (lib/skill-sets.ts). Seeded from what its threads ran; a card changes its own from the ✦ in its header.
export default function SkillsDrawer({ project, folders, notify }: { project: string | null; folders: string[]; notify: (err: unknown) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const cwd = project ?? picked ?? folders[0] ?? null;
  const { view, toggle, reload } = useSkillSet(cwd ? { cwd } : null, true, notify);
  if (!cwd) return <p className="px-3 py-3 text-[12px] text-muted">Open a project on the board to see its skills.</p>;
  const hidden = view ? skillsOffCount(view.rows) : 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-3 py-2 text-[11.5px] text-muted">
        {project ? (
          <span className="font-medium text-ink">{folderName(cwd)}</span>
        ) : (
          <select value={cwd} onChange={(e) => setPicked(e.target.value)} aria-label="Project" className="max-w-full rounded border border-line bg-canvas px-1 py-0.5 text-[12px] text-ink">
            {folders.map((f) => <option key={f} value={f}>{folderName(f)}</option>)}
          </select>
        )}
        <p className="mt-1">New threads here get these. {hidden > 0 && `${hidden} skills kept out.`} Hidden skills still run when you type /name.</p>
      </div>
      <SkillSetList view={view} forCard={false} onToggle={toggle} cwd={cwd} onInstalled={reload} />
    </div>
  );
}
