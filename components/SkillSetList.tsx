"use client";

import { useState } from "react";
import { groupRows } from "@/lib/skill-set-view";
import { openLocalReview, useLibraryScans } from "@/lib/use-skill-search";
import type { SkillScan, SkillSetRow, SkillSetView } from "@/lib/types";
import SearchField from "./SearchField";
import { ScanBadge } from "./SkillScanPill";
import SkillSearchResults from "./SkillSearchResults";

interface Props {
  view: SkillSetView | null;
  forCard: boolean;
  onToggle: (name: string, on: boolean) => void;
  // The folder whose library this is, for the scan and skills.sh's "installed" marks.
  cwd?: string;
  // A skill from skills.sh landed in the library.
  onInstalled?: () => void;
}

// The rows of a skill set, grouped Weft · This project · Yours · Plugins, each with a switch. In a card's
// ✦ menu (forCard) a row the card changed from its project's set carries a dot; a row Weft's scan flagged
// carries a ⚠ that opens its review. A filter also searches skills.sh, below your own.
export default function SkillSetList({ view, forCard, onToggle, cwd, onInstalled }: Props) {
  const [query, setQuery] = useState("");
  const { scans, reload } = useLibraryScans(cwd, Boolean(view));
  if (!view) return <p className="px-3 py-3 text-[12px] text-muted">Loading skills…</p>;
  const groups = groupRows(view.rows, query);
  const review = (name: string) => void openLocalReview(cwd, name).catch((err: unknown) => console.error(err));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-3 py-2">
        <SearchField query={query} onQuery={setQuery} label="Filter skills or search skills.sh" />
        {!view.seeded && <p className="mt-1.5 text-[11px] text-faint">Reading this project’s threads to pick its skills. Until then every skill is on.</p>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {groups.map((g) => (
          <section key={g.title}>
            <h3 className="flex justify-between px-3 pb-0.5 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
              <span>{g.title}</span>
              <span>{g.on}/{g.rows.length} on</span>
            </h3>
            {g.rows.map((row) => <SkillRow key={row.name} row={row} forCard={forCard} onToggle={onToggle} scan={scans[row.name]} onReview={() => review(row.name)} />)}
          </section>
        ))}
        {!groups.length && <p className="px-3 pt-3 text-[12px] text-muted">None of your skills match “{query}”.</p>}
        <SkillSearchResults
          query={query}
          cwd={cwd}
          onInstalled={() => {
            reload();
            onInstalled?.();
          }}
        />
      </div>
    </div>
  );
}

function SkillRow({ row, forCard, onToggle, scan, onReview }: { row: SkillSetRow; forCard: boolean; onToggle: (name: string, on: boolean) => void; scan?: SkillScan; onReview: () => void }) {
  const title = row.kind === "plugin" ? `${row.label ?? row.name} · ${row.skills ?? 0} skills` : `/${row.name}`;
  const hint = forCard && row.changedHere ? (row.on ? "On for this card; off in the project" : "Off for this card; on in the project") : undefined;
  return (
    <label className={`flex cursor-pointer items-start gap-2 px-3 py-1.5 hover:bg-sunken ${row.on ? "" : "opacity-60"}`} title={hint}>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-[12.5px] font-medium text-ink">
          <span className="truncate">{title}</span>
          {hint && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label={hint} />}
          <ScanBadge scan={scan} onOpen={onReview} />
        </span>
        {row.description && <span className="line-clamp-2 text-[11.5px] leading-snug text-muted">{row.description}</span>}
      </span>
      <input type="checkbox" role="switch" checked={row.on} onChange={(e) => onToggle(row.name, e.target.checked)} className="mt-0.5 shrink-0 accent-[var(--color-accent)]" aria-label={`${title} ${row.on ? "on" : "off"}`} />
    </label>
  );
}
