import { publish } from "./bus";
import { withFolder } from "./project-list";
import { listProjects } from "./settings";
import { save, settings } from "./settings-store";

// The folders added to a project ("Add Folder…" on its right-click menu, lib/project-menu.ts): a project can be
// more than one folder (an app and its API, a site and its content repo). Every thread in the project gets them
// as its own: passed to the CLI as additionalDirectories (readScopeFor in lib/runner-state.ts), and inside the
// project for the folder gate (grantedFor in lib/folder-guard.ts).

// A card's cwd is its project's folder (an isolated card's too: its worktree is workDir), so it looks up by that.
export function projectFolders(project: string): string[] {
  return [...(settings().projects.find((p) => p.path === project)?.folders ?? [])];
}

export function setProjectFolder(project: string, folder: string, on: boolean) {
  const s = settings();
  s.projects = withFolder(s.projects, project, folder, on);
  save();
  publish({ type: "projects", projects: listProjects() });
}
