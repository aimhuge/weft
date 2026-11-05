// A shared folder app follows its sources (docs/architecture/mini-app-hosting.md): after lib/app-build-watch.ts rebuilds
// ~/.weft/apps/<slug>, every app whose page lives in that folder and has a share link is synced to weft.zip the way
// Share… syncs it when it opens (readAppShare in lib/app-share.ts): the page, files and manifest go up when they changed,
// the mode, owner and address stay, and a plan over its room keeps serving what it had. It waits a few seconds after the
// last build of that folder, so a thread saving ten files uploads once. Keys aren't pushed from here: that may need
// Touch ID, so it stays with Share… (lib/app-share-keys.ts). Before this, a shared app kept its old page and manifest
// until someone opened Share…, and a hosted dashboard's new reads answered 404 "isn't in the manifest".
import path from "node:path";
import { APPS_DIR } from "./app-build";
import { isAppFolderUrl } from "./app-folder";
import { readAppShare } from "./app-share";
import { isDeployed } from "./home";
import { listApps } from "./mini-app-store";
import type { MiniApp } from "./mini-apps";

const DEBOUNCE_MS = 5_000;
const log = (line: string) => console.warn(`[weft/app-share] ${line}`);

// The ids of the apps shown from ~/.weft/apps/<slug> that have a share link.
export function sharedAppIdsIn(slug: string, apps: MiniApp[]): string[] {
  const folder = path.join(APPS_DIR(), slug);
  return apps.filter((a) => a.share?.id && isAppFolderUrl(a.url)?.folder === folder).map((a) => a.id);
}

// Syncs each shared app in the folder, one at a time; a failure is one log line, never a crash.
export async function republishSharedApps(
  slug: string,
  { apps = listApps, sync = readAppShare }: { apps?: () => MiniApp[]; sync?: (appId: string) => Promise<unknown> } = {},
): Promise<string[]> {
  if (isDeployed()) return [];
  const ids = sharedAppIdsIn(slug, apps());
  for (const id of ids) {
    try {
      await sync(id);
    } catch (err) {
      log(`republish ${slug} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return ids;
}

// One pending republish per folder, restarted by every build of it.
export function republishScheduler({
  run = (slug: string) => republishSharedApps(slug),
  debounceMs = DEBOUNCE_MS,
}: { run?: (slug: string) => Promise<unknown>; debounceMs?: number } = {}) {
  const timers = new Map<string, NodeJS.Timeout>();
  const schedule = (slug: string) => {
    clearTimeout(timers.get(slug));
    timers.set(slug, setTimeout(() => {
      timers.delete(slug);
      void run(slug);
    }, debounceMs));
  };
  const stop = () => {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  };
  return { schedule, stop, pendingCount: () => timers.size };
}
