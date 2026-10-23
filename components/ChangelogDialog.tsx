"use client";

import { useEffect, useState } from "react";
import { call } from "@/lib/client";
import type { ChangelogEntry } from "@/lib/changelog";
import { closeChangelog, useChangelogFolder } from "@/lib/changelog-open";
import { groupEntries, groupTitle, stateLine } from "@/lib/changelog-view";
import { selectCard } from "@/lib/onboarding-events";
import { folderName } from "@/lib/project-bar";
import Markdown from "./Markdown";
import Modal from "./Modal";

// A project's changelog (lib/changelog.ts): what its threads shipped, grouped Unreleased then by version, each entry
// with where it stands (draft, committed <sha>, released) and a link to the card that wrote it. Read-only: Weft writes
// CHANGELOG.md itself after each commit (lib/changelog-write.ts). Opened from the project menu and the palette (lib/changelog-open.ts).

const KIND = "rounded px-1.5 py-px text-[10.5px] font-medium uppercase tracking-wide bg-sunken text-muted";

type Loaded = { project: string; entries: ChangelogEntry[] };

function Entry({ entry }: { entry: ChangelogEntry }) {
  const open = () => {
    if (!entry.cardId) return;
    closeChangelog();
    selectCard(entry.cardId);
  };
  return (
    <li className="border-b border-line py-2 last:border-0">
      <div className="flex items-start gap-2">
        <span className={KIND}>{entry.kind}</span>
        <Markdown text={entry.text} className="min-w-0 flex-1 text-[12.5px]" />
      </div>
      <div className="mt-1 flex items-center gap-2 pl-1 text-[11px] text-faint">
        <span className={entry.sha || entry.version ? "" : "text-warn"}>{stateLine(entry)}</span>
        {entry.cardId && (
          <button type="button" onClick={open} className="truncate text-accent hover:underline" title="Open the card that wrote it">
            ↗ {entry.cardTitle ?? "card"}
          </button>
        )}
      </div>
    </li>
  );
}

// Keyed by folder, so another project's dialog starts from a fresh load.
export default function ChangelogDialog() {
  const folder = useChangelogFolder();
  return folder ? <ChangelogBody key={folder} folder={folder} /> : null;
}

function ChangelogBody({ folder }: { folder: string }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    call<Loaded>("GET", `/api/changelog?folder=${encodeURIComponent(folder)}`).then(
      (next) => {
        if (!live) return;
        setData(next);
        setError("");
      },
      (err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      live = false;
    };
  }, [folder]);
  const groups = groupEntries(data?.entries ?? []);
  return (
    <Modal title={`Changelog · ${folderName(data?.project ?? folder)}`} onClose={closeChangelog} placement="top" className="w-full max-w-[600px]">
      <div className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto px-4 pb-4 pt-1">
        {error && <p className="text-[12px] text-danger">{error}</p>}
        {!data && !error && <p className="text-[12px] text-faint">Loading…</p>}
        {data && !groups.length && (
          <p className="text-[12px] text-muted">Nothing yet. Threads add entries here as they ship (mcp__board__changelog_add), instead of editing CHANGELOG.md.</p>
        )}
        {data && groups.length > 0 && (
          <p className="text-[11.5px] text-faint">Weft commits CHANGELOG.md after each card&apos;s commit; a version bump moves Unreleased under it.</p>
        )}
        {groups.map((g) => (
          <section key={g.version ?? "unreleased"}>
            <h3 className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-faint">{groupTitle(g)}</h3>
            <ul>{g.entries.map((e) => <Entry key={e.id} entry={e} />)}</ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
