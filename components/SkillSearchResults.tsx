"use client";

import { useState } from "react";
import { openCardById } from "@/lib/open-card";
import { skillRegistry, startSkillThread } from "@/lib/skill-registry-client";
import { useSkillReview, useSkillSearch } from "@/lib/use-skill-search";
import type { RemoteSkill, RemoteSkillPreview } from "@/lib/types";
import { ScanPills, topFindings } from "./SkillScanPill";

// Under the ✦ filter: what skills.sh has for the same words (lib/skill-registry.ts). A row's name opens a new
// thread on the skill (lib/skill-thread.ts), which installs it once you say so; its ▾ opens Weft's static scan
// here, with Review (an AI review in the pane) and Install (the copy Weft scanned, into ~/.claude/skills). A
// dangerous one asks before it installs.

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

export default function SkillSearchResults({ query, cwd, onInstalled }: { query: string; cwd?: string; onInstalled: () => void }) {
  const { skills, error, loading } = useSkillSearch(query, cwd);
  if (query.trim().length < 2) return null;
  return (
    <section aria-label="From skills.sh">
      <h3 className="flex justify-between px-3 pb-0.5 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
        <span>From skills.sh</span>
        {loading && <span>Searching…</span>}
      </h3>
      {error && <p className="px-3 py-1 text-[11.5px] text-muted">Couldn’t reach skills.sh: {error}</p>}
      {!loading && !error && !skills.length && <p className="px-3 py-1 text-[11.5px] text-muted">Nothing on skills.sh for “{query.trim()}” either.</p>}
      {skills.map((s) => <RemoteRow key={s.id} hit={s} cwd={cwd} onInstalled={onInstalled} />)}
    </section>
  );
}

function RemoteRow({ hit, cwd, onInstalled }: { hit: RemoteSkill; cwd?: string; onInstalled: () => void }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<RemoteSkillPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const message = (err: unknown) => setError(err instanceof Error ? err.message : String(err));
  const toggle = () => {
    setOpen((o) => !o);
    if (!preview) skillRegistry.preview(hit.id, cwd).then(setPreview, message);
  };
  // The name opens a thread that shows the skill's page, has it scanned and reviewed, and installs it on your word.
  const openThread = () => {
    if (!cwd) {
      toggle();
      return;
    }
    setStarting(true);
    startSkillThread(hit, cwd).then(openCardById, (err: unknown) => {
      setOpen(true);
      message(err);
    }).finally(() => setStarting(false));
  };
  return (
    <div className="px-3 py-1.5 hover:bg-sunken">
      <div className="flex items-baseline gap-1">
        <button type="button" onClick={openThread} disabled={starting} title={`Open /${hit.name} in a new thread: its page, Weft's scan and review, then install`} className="flex min-w-0 flex-1 items-baseline gap-1 text-left">
          <span className="truncate text-[12.5px] font-medium text-ink">/{hit.name}</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-faint">{starting ? "Starting a thread…" : `${hit.source} · ${compact(hit.installs)}`}</span>
          {(hit.installed || preview?.installed) && <span className="text-[10.5px] text-muted">Installed</span>}
        </button>
        <button type="button" onClick={toggle} aria-expanded={open} aria-label={`Quick scan of /${hit.name}`} title="Quick scan here" className="shrink-0 rounded px-1 text-[11px] text-faint hover:bg-canvas hover:text-ink">
          {open ? "▴" : "▾"}
        </button>
      </div>
      {open && !preview && <p className="mt-1 text-[11.5px] text-muted">{error ?? "Fetching and scanning…"}</p>}
      {open && preview && <RemoteDetail preview={preview} onInstalled={() => {
        setPreview({ ...preview, installed: true });
        onInstalled();
      }} />}
    </div>
  );
}

function RemoteDetail({ preview, onInstalled }: { preview: RemoteSkillPreview; onInstalled: () => void }) {
  const { state, open } = useSkillReview({ id: preview.id, hash: preview.hash }, preview.review);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const risky = preview.scan.verdict === "danger" || (state.status === "done" && state.review.verdict === "unsafe");
  const install = () => {
    if (risky && !window.confirm(`Weft's scan flagged ${preview.name} as dangerous. Install it anyway?`)) return;
    setBusy(true);
    skillRegistry.install(preview.id, risky).then(onInstalled, (err: unknown) => setError(err instanceof Error ? err.message : String(err))).finally(() => setBusy(false));
  };
  const reviewLabel = state.status === "done" ? "Open review" : state.status === "running" ? "Reviewing…" : state.status === "failed" ? "Retry review" : "AI review";
  return (
    <div className="mt-1 space-y-1.5">
      {preview.description && <p className="line-clamp-3 text-[11.5px] leading-snug text-muted">{preview.description}</p>}
      <ScanPills scan={preview.scan} review={state} />
      {state.status === "done" && <p className="text-[11.5px] leading-snug text-ink">{state.review.summary}</p>}
      {topFindings(preview.scan).map((f, i) => (
        <p key={i} className="truncate text-[11px] text-muted" title={f.excerpt}>
          {f.severity === "danger" ? "⛔" : "⚠"} {f.message}{f.file ? ` · ${f.file}${f.line ? `:${f.line}` : ""}` : ""}
        </p>
      ))}
      {preview.offline && <p className="text-[11px] text-faint">skills.sh is unreachable; this is Weft’s kept copy.</p>}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
      <div className="flex gap-1.5 pt-0.5">
        <button type="button" onClick={() => void open().catch((err: unknown) => setError(String(err)))} className="rounded border border-line px-2 py-0.5 text-[11.5px] text-ink hover:bg-canvas">
          {reviewLabel}
        </button>
        {!preview.installed && (
          <button type="button" disabled={busy} onClick={install} className={`rounded px-2 py-0.5 text-[11.5px] font-medium text-white disabled:opacity-50 ${risky ? "bg-red-600" : "bg-accent"}`}>
            {busy ? "Installing…" : risky ? "Install anyway…" : "Install"}
          </button>
        )}
      </div>
    </div>
  );
}
