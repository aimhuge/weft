"use client";

// The folders the board's header and drawers work in, from the project in view (lib/board-derive.ts workFolder):
// the header badges read any project whose host serves them (a worker's from its snapshot, H4 of
// docs/architecture/project-hosts.md), while the terminal and the account menu's sync stay on this Mac's folders.
import { hostFor } from "./project-host";
import { localPath } from "./worker-project";

export function projectFolders(where: string | null | undefined, home: string) {
  const folder = localPath(where) ?? null;
  const reads = where && hostFor(where).can("reads") ? where : folder;
  return { folder, reads, terminalCwd: folder ?? home };
}
