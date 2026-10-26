// The saved project list's changes, as pure functions over the list (lib/settings.ts stores it).
import type { Project } from "./types";

export type ProjectMarks = { pinned?: boolean; hidden?: boolean };

// The folder just used, first. Using a hidden project brings its chip back; a pinned one stays pinned and
// is never the one dropped when the list is past `max`.
export function touched(projects: Project[], folder: string, now: number, max: number): Project[] {
  const old = projects.find((p) => p.path === folder);
  const entry: Project = { path: folder, lastUsedAt: now, ...(old?.pinned && { pinned: true }) };
  return [entry, ...projects.filter((p) => p.path !== folder)].filter((p, i) => i < max || p.pinned);
}

// Pins or hides a project from its right-click menu. A folder only cards run in isn't saved yet, so it's
// added with no use of its own (its cards still date it on the bar).
export function marked(projects: Project[], folder: string, marks: ProjectMarks): Project[] {
  const next: Project = { ...(projects.find((p) => p.path === folder) ?? { path: folder, lastUsedAt: 0 }), ...marks };
  if (!next.pinned) delete next.pinned;
  if (!next.hidden) delete next.hidden;
  return [...projects.filter((p) => p.path !== folder), next];
}
