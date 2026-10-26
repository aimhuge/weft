// Display helpers for the project bar: the folder name and a path shortened with the home dir. Pure,
// so the bar component and the command palette can share the same rules.
import type { ProjectSummary } from "./board-view";
import { folderName } from "./format";
import { filterByQuery } from "./text-filter";

// "/Users/me/dev/app/" -> "app": the chip's label, ignoring any trailing slashes. Re-exported rather than
// reimplemented — lib/format.ts's folderName is the one the provider views, services and webhooks already
// use, and two copies of "the last path segment" is one too many. It answers identically on every input
// (trailing slashes, relative paths, "", "/"), which lib/project-bar.test.ts asserts.
export { folderName } from "./format";

// "/Users/me/dev/app" with home "/Users/me" -> "~/dev/app"
export function shortPath(folder: string, home: string) {
  if (home && (folder === home || folder.startsWith(`${home}/`))) return `~${folder.slice(home.length)}`;
  return folder;
}

// "1 card" / "5 cards", for the menu and the chips' counts.
export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

// What a project's status dot should say for screen readers: "N needs you" and "M running".
export function statusLabel(project: ProjectSummary) {
  const parts: string[] = [];
  if (project.needsYou > 0) parts.push(`${project.needsYou} ${project.needsYou === 1 ? "needs" : "need"} you`);
  if (project.running > 0) parts.push(`${project.running} running`);
  return parts.length ? `, ${parts.join(", ")}` : "";
}

// The More menu's filter: a project matches on its folder name (home's too, which reads as "~") and its ~-shortened path (lib/text-filter.ts).
export function filterProjects(projects: ProjectSummary[], query: string, home: string): ProjectSummary[] {
  return filterByQuery(projects, query, (p) => [folderName(p.path), shortPath(p.path, home)]);
}

// The projects that get a chip, in order: every pinned one, then the most recent up to `recent` chips in
// all, then the selected project if it isn't among them, so the current filter is always visible. A
// hidden project only gets one while it's selected.
export function chipProjects(projects: ProjectSummary[], selected: string | null, recent: number): ProjectSummary[] {
  const shown = projects.filter((p) => !p.hidden);
  const pinned = shown.filter((p) => p.pinned);
  const chips = [...pinned, ...shown.filter((p) => !p.pinned).slice(0, Math.max(0, recent - pinned.length))];
  if (!selected || chips.some((p) => p.path === selected)) return chips;
  const extra = projects.find((p) => p.path === selected) ?? { path: selected, lastActivity: 0, cards: 0, running: 0, needsYou: 0 };
  return [...chips, extra];
}
