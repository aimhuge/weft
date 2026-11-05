// The saved project list's changes, as pure functions over the list (lib/settings.ts stores it).
import type { Project } from "./types";

export type ProjectMarks = { pinned?: boolean; hidden?: boolean };

// The folder just used, first. Using a hidden project brings its chip back; a pinned one stays pinned and
// is never the one dropped when the list is past `max`, and its added folders stay with it.
export function touched(projects: Project[], folder: string, now: number, max: number): Project[] {
  const old = projects.find((p) => p.path === folder);
  const entry: Project = { path: folder, lastUsedAt: now, ...(old?.pinned && { pinned: true }), ...(old?.folders?.length && { folders: old.folders }) };
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

// Adds a folder to a project, or takes one off ("Add Folder…" on its right-click menu): every thread in the project
// may then read and edit there as if it were the project's own (lib/project-folders.ts). The project itself is never one.
export function withFolder(projects: Project[], project: string, folder: string, on: boolean): Project[] {
  const old = projects.find((p) => p.path === project) ?? { path: project, lastUsedAt: 0 };
  const rest = (old.folders ?? []).filter((f) => f !== folder);
  const folders = on && folder !== project ? [...rest, folder] : rest;
  const next: Project = { ...old, folders };
  if (!folders.length) delete next.folders;
  return [...projects.filter((p) => p.path !== project), next];
}
