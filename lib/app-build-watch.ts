// Watches ~/.weft/apps recursively and rebuilds any app folder whose sources change (docs/architecture/mini-app-hosting.md,
// lib/app-build.ts). Started once per server boot from prewarm() in lib/copilot.ts, so a thread saving App.tsx
// rebuilds in ~150 ms and the pane reloads. A build's own outputs (generated index.html, app.js, app.css, assets/,
// the build record) are ignored so a build never triggers itself. Watcher errors are logged one line and never crash
// the server, since a stray ENOENT in dev mode shouldn't take down the Next process. After a build, a shared app in that
// folder goes up to weft.zip again (lib/app-share-republish.ts), so its hosted copy follows its sources.
import fs from "node:fs";
import path from "node:path";
import { APPS_DIR, buildApp, isBuildOutput, readBuildInfo } from "./app-build";
import { republishScheduler } from "./app-share-republish";

// One pending rebuild per app, debounced 150 ms after the last change to that app. Saved on globalThis so dev
// reloads don't end up with two watchers racing on the same folder.
const g = globalThis as unknown as { __weftAppBuildWatcher?: { stop(): void; rebuild(slug: string): void } };

const DEBOUNCE_MS = 150;
const log = (line: string) => console.warn(`[weft/app-build] ${line}`);

// The watcher factory. Tests inject `fs` and `build`; the production call takes them from the platform.
export function startAppBuildWatcher({
  fs: fsLib = fs,
  build = buildApp,
  debounceMs = DEBOUNCE_MS,
  republish = republishScheduler(),
}: {
  fs?: typeof fs;
  build?: (slug: string) => Promise<unknown>;
  debounceMs?: number;
  republish?: { schedule(slug: string): void; stop(): void };
} = {}): { stop(): void; rebuild(slug: string): void; pendingCount(): number } {
  if (g.__weftAppBuildWatcher) return g.__weftAppBuildWatcher as { stop(): void; rebuild(slug: string): void; pendingCount(): number };
  const appsDir = APPS_DIR();
  fsLib.mkdirSync(appsDir, { recursive: true });
  const timers = new Map<string, NodeJS.Timeout>();
  // Each app slug has at most one rebuild queued at a time, so rapid saves coalesce into a single build.
  const rebuild = (slug: string) => {
    const prev = timers.get(slug);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      timers.delete(slug);
      build(slug)
        .then(() => republish.schedule(slug))
        .catch((err: unknown) => log(`rebuild ${slug} failed: ${err instanceof Error ? err.message : String(err)}`));
    }, debounceMs);
    timers.set(slug, t);
  };
  // On first start: build every app that has no build record, and sync every shared one, which catches an edit made
  // while Weft was closed (an unchanged link costs one row read). Both are skipped when the server is deployed.
  for (const entry of fsLib.readdirSync(appsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const info = readBuildInfo(slug);
    if (!info) rebuild(slug);
    else republish.schedule(slug);
  }
  // fs.watch recursive is supported on macOS and Windows; on Linux it isn't, so an app whose only edit is in
  // a deep subfolder might miss a change there. The build still runs on the next start, which is the fallback.
  let watcher: ReturnType<typeof fsLib.watch> | null = null;
  try {
    watcher = fsLib.watch(appsDir, { recursive: true }, (event, filename) => {
      if (!filename) return;
      const full = path.join(appsDir, filename);
      // path.relative handles the absolute filename that fs.watch hands us; if it isn't under appsDir, ignore.
      const rel = path.relative(appsDir, full);
      if (rel.startsWith("..") || path.isAbsolute(rel)) return;
      const parts = rel.split(/[/\\]/).filter(Boolean);
      const slug = parts[0];
      if (!slug) return;
      if (isBuildOutput(appsDir, full)) return;
      if (slug.startsWith(".") || slug === "node_modules") return;
      rebuild(slug);
    });
    watcher.on("error", (err: unknown) => log(`watcher error: ${err instanceof Error ? err.message : String(err)}`));
  } catch (err) {
    log(`could not start watcher: ${err instanceof Error ? err.message : String(err)}`);
  }
  const stop = () => {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    republish.stop();
    if (watcher) {
      try {
        watcher.close();
      } catch {}
      watcher = null;
    }
    if (g.__weftAppBuildWatcher === handle) g.__weftAppBuildWatcher = undefined;
  };
  const handle = { stop, rebuild, pendingCount: () => timers.size };
  g.__weftAppBuildWatcher = handle;
  return handle;
}

// The current watcher, if any. Tests read this to make sure debounces fire or that a stop really stopped.
export function currentAppBuildWatcher() {
  return g.__weftAppBuildWatcher;
}

// Test-only: drop the global so the next startAppBuildWatcher() call boots fresh. The watcher test uses this so one
// test doesn't leak into the next.
export function _resetAppBuildWatcherForTests(): void {
  if (g.__weftAppBuildWatcher) g.__weftAppBuildWatcher.stop();
  g.__weftAppBuildWatcher = undefined;
}