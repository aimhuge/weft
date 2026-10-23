"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { AppPreview } from "./app-preview";
import type { AppShareState, AppShareUpdate } from "./app-share-types";
import { call } from "./client-api";
import type { MiniApp } from "./mini-apps";

// The mini apps (app/api/apps), shared by the rail's apps (components/AppsRail.tsx) and the browser
// pane's Save as app button (components/SaveAppButton.tsx): one list in memory, so saving in the pane
// shows on the rail at once.

let apps: MiniApp[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function set(next: MiniApp[]) {
  apps = next;
  loaded = true;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const appsApi = {
  list: () => call<{ apps: MiniApp[] }>("GET", "/api/apps"),
  save: (url: string, name?: string) => call<{ app: MiniApp }>("POST", "/api/apps", { url, name }),
  update: (id: string, patch: { name?: string; to?: number }) => call<{ app: MiniApp }>("PATCH", "/api/apps", { id, ...patch }),
  remove: (id: string) => call<{ ok: true }>("DELETE", "/api/apps", { id }),
  // The app's Share dialog: its weft.zip link, or why it can't have one (lib/app-share.ts).
  getShare: (id: string) => call<AppShareState>("GET", `/api/apps/share?id=${encodeURIComponent(id)}`),
  setShare: (id: string, update: AppShareUpdate) => call<AppShareState>("PUT", "/api/apps/share", { id, ...update }),
  // Its link preview (lib/app-share-preview-actions.ts): the card a chat shows, your description, Refresh preview.
  previewCard: (id: string) => call<{ image: string | null; preview: AppPreview | null }>("GET", `/api/apps/share/preview?id=${encodeURIComponent(id)}`),
  describe: (id: string, description: string | null) => call<AppShareState>("PUT", "/api/apps/share/preview", { id, description }),
  refreshPreview: (id: string) => call<AppShareState>("POST", "/api/apps/share/preview", { id }),
};

export function reloadApps() {
  return appsApi.list().then(({ apps: next }) => set(next));
}

// Each change goes to the server, then the list reloads from it, so every view agrees with apps.json.
const after = (p: Promise<unknown>) => p.then(reloadApps);

export const appActions = {
  save: (url: string, name?: string) => after(appsApi.save(url, name)),
  rename: (id: string, name: string) => after(appsApi.update(id, { name })),
  move: (id: string, to: number) => after(appsApi.update(id, { to })),
  remove: (id: string) => after(appsApi.remove(id)),
};

export function useMiniApps(): MiniApp[] {
  const list = useSyncExternalStore(subscribe, () => apps, () => apps);
  useEffect(() => {
    if (!loaded) void reloadApps().catch(() => {});
    // An app saved elsewhere (a thread through app/api/apps, another window) shows when you come back.
    const onFocus = () => void reloadApps().catch(() => {});
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  return list;
}

// For tests: forget the list so the next hook loads it again.
export function resetMiniApps() {
  apps = [];
  loaded = false;
  listeners.clear();
}
