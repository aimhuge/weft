// The project each left-rail drawer reads (components/LibraryRail.tsx), from the board's project in view. On this Mac
// every drawer reads the project itself. A worker project's host has no vault or provider links of its own
// (`can("vault")` is false), so the drawers that are per repo rather than per machine (🔐, ▲ Vercel, Supabase,
// Cloudflare, BlastCP, Slack, ✦ Skills) read its twin here: this Mac's checkout of the same repo
// (lib/worker-twin.ts), names only, the values still behind Touch ID. Those that are per host (🖥 Services, GitHub's
// issue sync, 🪝 webhooks) read the worker project itself. With no twin, the per-repo drawers read the worker path
// too, which matches no folder of this Mac's, so they show nothing for it rather than every project.
import { hostFor } from "./project-host";
import { twinByRepo, twinOf } from "./worker-twin";

export interface RailProjects {
  repo: string | null;
  host: string | null;
}

export function railProjects(project: string | null, folders: readonly string[], vaults: readonly { label: string; folder: string }[]): RailProjects {
  if (!project || hostFor(project).can("vault")) return { repo: project, host: project };
  return { repo: twinOf(project, folders) ?? twinByRepo(project, vaults) ?? project, host: project };
}

// The folders GitHub's drawer asks about: the board's, and the worker project in view, whose issues can sync to it.
export function githubFolders(folders: readonly string[], host: string | null): string[] {
  return host && !hostFor(host).can("vault") && !folders.includes(host) ? [...folders, host] : [...folders];
}
