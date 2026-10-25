import { shell } from "./browser-tools";
import type { AppShareKeys, AppShareState } from "./app-share-types";

// A folder app's keys follow its link (docs/architecture/mini-app-hosting.md): every time Share… opens or saves a
// folder link, the server asks Electron main, which holds the vault, to push the keys the manifest needs to weft.zip
// (electron/app-secrets-push.cjs). Main sends them only when they changed since they last went up (or never did),
// after one Touch ID; unchanged keys, or ones you declined this run, come back untouched with no sheet. Share…'s
// Upload secrets sends them again whatever main remembers. Values never pass through this server, only the names.

export async function withKeys(appId: string, state: AppShareState): Promise<AppShareState> {
  if (state.kind !== "ok" || !state.id || state.shows !== "folder") return state;
  const keys = await pushKeys(appId);
  return keys ? { ...state, keys } : state;
}

// What to tell the dialog, or null when there's nothing new to say (unchanged, or no names to send).
async function pushKeys(appId: string): Promise<AppShareKeys | null> {
  try {
    const out = await shell("/apps/push-secrets", { appId, ifChanged: true });
    if (typeof out.error === "string") return { error: out.error };
    const pushed = names(out.pushed);
    return out.unchanged === true || pushed.length === 0 ? null : { pushed, missing: names(out.missing) };
  } catch (err) {
    return { error: `Your keys didn't go up: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const names = (value: unknown): string[] => (Array.isArray(value) ? value.filter((n): n is string => typeof n === "string") : []);
