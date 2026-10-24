// Every shared mini app's link preview kept current without anyone opening the Share dialog (lib/app-preview-capture.ts):
// a timer walks the apps with a share and makes each preview again once it's stale (a changed page, PREVIEW_MAX_AGE_MS,
// or a capture that failed). One app at a time, so the hidden capture window and Haiku never pile up. Started with
// cloud sync (lib/cloud-sync-start.ts); signed out, every app is skipped.
import { globalSingleton } from "./global-singleton";
import { listApps } from "./mini-app-store";

export const REFRESH_MS = 15 * 60 * 1000;
export const FIRST_REFRESH_MS = 2 * 60 * 1000;

type Refresh = (appId: string) => Promise<void>;

async function defaultRefresh(appId: string): Promise<void> {
  // Imported when the timer first fires: the share code pulls in the account and the blob store.
  const { refreshIfStale } = await import("./app-share-preview-actions");
  return refreshIfStale(appId);
}

// Walks the shared apps in order; an app that can't refresh (signed out, not shared any more) is skipped.
export async function refreshSharedPreviews(refresh: Refresh = defaultRefresh): Promise<number> {
  let done = 0;
  for (const app of listApps()) {
    if (!app.share?.id) continue;
    try {
      await refresh(app.id);
      done += 1;
    } catch {
      // the next tick tries again
    }
  }
  return done;
}

export function startPreviewRefresh(refresh: Refresh = defaultRefresh): () => void {
  const state = globalSingleton("__weftPreviewRefresh", () => ({
    timers: [] as ReturnType<typeof setTimeout>[],
    running: false,
    stop: null as null | (() => void),
  }));
  // The timer is shared: a second start hands back the same stop, so whichever caller tears down last
  // can still clear the timers.
  if (state.stop) return state.stop;
  const tick = () => {
    if (state.running) return;
    state.running = true;
    void refreshSharedPreviews(refresh).finally(() => {
      state.running = false;
    });
  };
  state.timers.push(setTimeout(tick, FIRST_REFRESH_MS), setInterval(tick, REFRESH_MS));
  state.stop = () => {
    for (const t of state.timers) clearTimeout(t);
    state.timers = [];
    state.stop = null;
  };
  return state.stop;
}
