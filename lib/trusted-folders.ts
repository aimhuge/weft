// The two write paths behind Settings → Security's trusted-folders row, kept out of the component so it stays
// inside the 60-line ceiling. Both are plain async-to-state transitions with nothing to render, so there was
// no reason for them to be JSX-adjacent.
//
// Both grant and revoke go through /api/folders — the same route the folder guard's "Always" button uses, so
// the prompt and Settings land in one place rather than two code paths that can drift apart.

import { api } from "@/lib/client";

// Takes a folder back out of the always-allowed list. A card already holding it in its read scope keeps it
// until that turn ends: a revoke stops new work, it doesn't retract a permission already handed out.
export function revokeFolder(folder: string): Promise<{ ok: true }> {
  return api.unallowFolder(folder);
}

// Asks the OS for a folder path and grants it. Electron's own dialog (window.weft.dialog.openFolder, the one
// the project and repo pickers use). Trusted folders are always ones you don't work in, so there's no
// recent-projects list to offer — asking the OS is the honest way to get one.
//
// Resolves to the folder it added, or null when the user cancelled the dialog. Throws when there's no
// Electron bridge (the web board), so the caller can say so and point at the "Always" path.
export async function addFolder(): Promise<string | null> {
  const bridge = window.weft;
  if (!bridge) {
    throw new Error("Weft can't pick a folder here. Add it with Always on a thread's folder prompt instead.");
  }
  const picked = await bridge.dialog.openFolder();
  if (!picked) return null;
  await api.allowFolder(picked);
  return picked;
}