import { shell } from "./browser-tools";
import type { AppShareKeys, AppShareState } from "./app-share-types";

// A folder app's link goes up with its keys in the same request that makes it (docs/architecture/mini-app-hosting.md):
// the server asks Electron main, which holds the vault, to push the keys the manifest needs to weft.zip after one
// Touch ID (electron/app-secrets-push.cjs). A new link has no keys, so making one is when they go; Share…'s Upload
// secrets sends them again after a change. Values never pass through this server, only the names that went up.

export async function withKeys(isNew: boolean, appId: string, state: AppShareState): Promise<AppShareState> {
  if (!isNew || state.kind !== "ok" || !state.id || state.shows !== "folder") return state;
  return { ...state, keys: await pushKeys(appId) };
}

async function pushKeys(appId: string): Promise<AppShareKeys> {
  try {
    const out = await shell("/apps/push-secrets", { appId });
    if (typeof out.error === "string") return { error: out.error };
    return { pushed: names(out.pushed), missing: names(out.missing) };
  } catch (err) {
    return { error: `Your keys didn't go up: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const names = (value: unknown): string[] => (Array.isArray(value) ? value.filter((n): n is string => typeof n === "string") : []);
