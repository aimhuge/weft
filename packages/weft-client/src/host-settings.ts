// Which settings travel to a Weft Worker, and how (docs/architecture/project-hosts.md#settings-on-a-worker-wp3). Two
// lists, never overlapping, and everything else stays on the machine that wrote it:
//
// - ACCOUNT_SETTINGS: how a card behaves, wherever it runs. You set them on your Mac; they sync to your account and every
//   worker of yours mirrors them into its own settings.json (lib/worker-settings-sync.ts).
// - HOST_SETTINGS: what one machine can carry (its threads at once, its warm CLIs, its worktree pool, its default CLI).
//   Settings → Threads edits them per worker through the elevated settings.get / settings.put host verbs.
//
// Never on either list: allowed folders, the default permission mode, sync and worker folders, issue landings, the
// Goose provider and endpoint, and anything else that widens what a card may touch or where its traffic goes. A row
// from the network can't name them (remoteRefusal), and a worker drops them from a synced snapshot.
//
// GOOSE_SETTINGS are the one exception, and not by sync: the Goose provider and endpoint (where a Goose card's traffic
// goes) ride a settings.put only with a signed widening from the pairing Mac's Touch ID key (./widen.ts `goose`), which
// the worker checks against the key it pinned. A passkey can't sign one (lib/widen-check.ts).

// `agents` is your agents (Settings → Agents) and each worker project's default (lib/agent-sync.ts).
export const ACCOUNT_SETTINGS = ["automations", "pushOnDone", "doneModel", "doneEffort", "subagentModel", "threadPrompt", "backupModel", "agents"] as const;
export type AccountSetting = (typeof ACCOUNT_SETTINGS)[number];

export const HOST_SETTINGS = ["maxThreads", "keepAliveMinutes", "worktreePool", "defaultBackend"] as const;
export type HostSetting = (typeof HOST_SETTINGS)[number];

export const GOOSE_SETTINGS = ["gooseProviderId", "gooseBaseUrl"] as const;
export type GooseSetting = (typeof GOOSE_SETTINGS)[number];
export type GooseSettings = Partial<Record<GooseSetting, string>>;

/** One host's own settings, as settings.get reads them and settings.put takes them. The Goose pair reads back from a
 * worker that knows them; a put of either needs a signed widening. */
export interface HostSettings extends GooseSettings {
  maxThreads: number;
  keepAliveMinutes: number;
  worktreePool: number;
  defaultBackend: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** The fields of `source` a list names, and nothing else. A non-object reads as empty. */
export function pickSettings<K extends string>(source: unknown, fields: readonly K[]): Partial<Record<K, unknown>> {
  if (!isObject(source)) return {};
  const out: Partial<Record<K, unknown>> = {};
  for (const field of fields) if (Object.hasOwn(source, field) && source[field] !== undefined) out[field] = source[field];
  return out;
}

/** The first field a settings.put patch names that isn't a host setting, or null when every one is. */
export function foreignSetting(patch: unknown): string | null {
  if (!isObject(patch)) return null;
  const allowed: ReadonlySet<string> = new Set(HOST_SETTINGS);
  return Object.keys(patch).find((field) => !allowed.has(field)) ?? null;
}

/** The Goose fields a settings.put patch names, as they came (strings checked by the host), or null when it names none. */
export function gooseFieldsOf(patch: unknown): Record<string, unknown> | null {
  const picked = pickSettings(patch, GOOSE_SETTINGS);
  return Object.keys(picked).length ? picked : null;
}

/** A settings.put patch without its Goose fields: what still has to pass as host settings. */
export function withoutGoose(patch: unknown): unknown {
  if (!isObject(patch)) return patch;
  const goose: ReadonlySet<string> = new Set(GOOSE_SETTINGS);
  return Object.fromEntries(Object.entries(patch).filter(([field]) => !goose.has(field)));
}
