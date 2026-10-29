import type { SupabaseClient } from "@supabase/supabase-js";
import { globalSingleton } from "./global-singleton";
import { safeClient, signedIn } from "./signed-in-client";

// Which version of Weft this Mac runs, reported to app_versions once a UTC day on the league sync's timer
// (lib/league-sync.ts), while you're signed in. 📈 Growth counts accounts per version from it
// (supabase/migrations/20261029075755_app_versions.sql, docs/architecture/growth.md).

export interface AppVersionReport {
  version: string;
  // A packaged build runs `next start`; `pnpm desktop` from a git checkout runs `next dev`.
  channel: "release" | "dev";
  platform: string;
}

export interface AppVersionDeps {
  client?: () => SupabaseClient | null;
  report?: () => AppVersionReport | null;
  now?: () => number;
}

export function ownReport(env: Record<string, string | undefined> = process.env, platform: string = process.platform): AppVersionReport | null {
  // A server patch's build tag (`0.6.7+abc1234`) is dropped: the version is the release it patches.
  const version = env.NEXT_PUBLIC_APP_VERSION?.split("+")[0];
  if (!version) return null;
  return { version, channel: env.NODE_ENV === "production" ? "release" : "dev", platform };
}

const last = () => globalSingleton("__weftAppVersion", () => ({ key: "" }));

// Returns false when there was nobody to post as, nothing to post, or it was already posted today; a missing
// function (the migration isn't on this Supabase yet) is false too, so it waits quietly for the next tick.
export async function syncAppVersion({ client = safeClient, report = ownReport, now = Date.now }: AppVersionDeps = {}): Promise<boolean> {
  const r = report();
  if (!r) return false;
  const key = `${new Date(now()).toISOString().slice(0, 10)} ${r.version} ${r.channel}`;
  if (key === last().key) return false;
  const c = client();
  if (!c || !(await signedIn(c))) return false;
  const { error } = await c.rpc("app_version_submit", { p_version: r.version, p_channel: r.channel, p_platform: r.platform });
  if (error?.code === "PGRST202") return false;
  if (error) throw new Error(error.message);
  last().key = key;
  return true;
}
