import { shell } from "./browser-tools";
import { onProjectOpen } from "./project-open";

// When a project lands on the board (lib/project-open.ts, never inline on the start-a-card path), ask main for its
// vault ⇄ Vercel drift once: an unlinked folder costs a file read there, a linked one starts the background fetch of
// its Vercel env list (electron/vercel-env-cache.cjs), so the 🔐 and ▲ badges and the copilot have it when they look.
export function startVercelDrift(ask = shell) {
  onProjectOpen("vercel-drift", (folder) => ask("/vercel/env-drift", { folders: [folder] }).then(() => undefined, () => undefined));
}
