"use client";

// A Weft Worker project's snapshot on the desktop board (docs/architecture/project-hosts.md, H4): the header badges'
// reads for a worker:// project, from the row the worker published, read through /api/worker-board?project= and kept
// for a few seconds so the four badges and the age line share one request. A snapshot is the last thing the worker
// measured, so the header says how old it is when it's stale or the worker is offline ("12m ago, m1mini offline").
import { useEffect, useState } from "react";
import { apiFetch } from "./api-client";
import { timeAgo } from "./format";
import type { ProjectSnapshot, ReadProject } from "./project-reads";
import type { WorkerProjectStatus } from "./worker-project";

export interface SnapshotView {
  snapshot: ProjectSnapshot | null;
  // When the worker last wrote it; null when it never has.
  updatedAt: string | null;
  worker: string;
  status: WorkerProjectStatus;
}

export const SNAPSHOT_TTL_MS = 15_000;
// The worker writes a project at least every 10 minutes while it's up (lib/worker-projects.ts), so twice that is late.
export const STALE_MS = 20 * 60_000;

const views = new Map<string, { at: number; view: Promise<SnapshotView> }>();

async function load(project: string): Promise<SnapshotView> {
  const res = await apiFetch(`/api/worker-board?${new URLSearchParams({ project }).toString()}`);
  const body = (await res.json().catch(() => ({}))) as SnapshotView & { error?: string };
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export function fetchSnapshot(project: string, now = Date.now()): Promise<SnapshotView> {
  const known = views.get(project);
  if (known && now - known.at < SNAPSHOT_TTL_MS) return known.view;
  const view = load(project);
  views.set(project, { at: now, view });
  view.catch(() => views.delete(project));
  return view;
}

export const forgetSnapshots = () => views.clear();

// One badge's read, from the snapshot: null (no badge) when the worker hasn't measured it.
export const cloudRead: ReadProject = async (name, project) => (await fetchSnapshot(project)).snapshot?.[name] ?? null;

// What the header says about a snapshot's age: nothing while it's fresh and the worker is up.
export function snapshotAge(view: SnapshotView | null, now: number): string | null {
  if (!view) return null;
  const offline = view.status === "offline" ? `, ${view.worker} offline` : "";
  if (!view.updatedAt) return `No reads from ${view.worker} yet${offline}`;
  const at = Date.parse(view.updatedAt);
  if (!offline && now - at <= STALE_MS) return null;
  return `${timeAgo(at, now)}${offline}`;
}

// The snapshot of the project in view, read again when `refresh` moves (a turn ended somewhere).
export function useSnapshotView(project: string | null | undefined, refresh?: unknown): SnapshotView | null {
  const [loaded, setLoaded] = useState<{ project: string; view: SnapshotView } | null>(null);
  useEffect(() => {
    if (!project) return;
    let live = true;
    fetchSnapshot(project).then(
      (view) => {
        if (live) setLoaded({ project, view });
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [project, refresh]);
  return project && loaded?.project === project ? loaded.view : null;
}
