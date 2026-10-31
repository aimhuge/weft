// The projects on a Weft Worker: the folders under its work root, reported so the desktop board can list one before
// it has a card (lib/worker-board.ts). Only the names leave the box.
import fs from "node:fs";

// The checkouts under root, sorted. Hidden folders and loose files aren't projects; no root yet means none.
export function listProjectFolders(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

// Reports the folders when they've changed, so a heartbeat costs no extra call most of the time. A failed report is
// tried again on the next beat.
export function folderReporter(read: () => string[], report: (folders: string[]) => Promise<unknown>) {
  let last: string | null = null;
  return async () => {
    const folders = read();
    const key = JSON.stringify(folders);
    if (key === last) return;
    await report(folders);
    last = key;
  };
}
