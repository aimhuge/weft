// The settings that travel to a Weft Worker (docs/architecture/project-hosts.md#settings-on-a-worker-wp3), read and
// written on whichever host runs this. The two lists are @weft/client's (ACCOUNT_SETTINGS, HOST_SETTINGS); here is what
// each field is and how it's checked, so a worker refuses what this Mac's Settings would refuse.
//
// - hostSettings / applyHostSettings: one host's own settings, for the settings.get / settings.put verbs. A bad value
//   throws, and nothing is saved, like the settings route.
// - accountSettings / applyAccountSettings: the account's settings, as this Mac pushes them and a worker mirrors them.
//   Every field is sent explicitly (a default too), so a reset on the Mac resets the worker. A field that doesn't check
//   out is skipped on its own and the rest still apply; one that hasn't changed isn't written again.
import { agentsSnapshot, applyAgentsSnapshot, readAgentsSnapshot } from "./agent-sync";
import { readAutomations } from "./automation-rules";
import { backendFor, BACKEND_IDS, EFFORTS } from "./new-thread";
import { MAX_THREADS_CEILING } from "./settings-shared";
import {
  automations,
  backupModel,
  defaultBackend,
  doneEffort,
  doneModel,
  keepAliveMinutes,
  maxThreads,
  pushOnDone,
  setAutomations,
  setBackupModel,
  setDefaultBackend,
  setDoneEffort,
  setDoneModel,
  setKeepAliveMinutes,
  setMaxThreads,
  setPushOnDone,
  setSubagentModel,
  setThreadPrompt,
  setWorktreePoolSize,
  subagentModel,
  worktreePoolSize,
} from "./settings";
import { settings } from "./settings-store";
import { isSubagentModel } from "./subagents";
import type { Backend, Effort } from "./types";
import { ACCOUNT_SETTINGS, foreignSetting, pickSettings, type AccountSetting, type HostSettings } from "@weft/client";

const KEEP_ALIVE_MAX = 7 * 24 * 60;
const whole = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
const isBackend = (v: unknown): v is Backend => typeof v === "string" && (BACKEND_IDS as string[]).includes(v);
const isModel = (v: unknown): v is string => v === "" || (typeof v === "string" && backendFor(v) !== undefined);
const isEffort = (v: unknown): v is Effort | "" => typeof v === "string" && EFFORTS.some((e) => e.id === v);

export function hostSettings(): HostSettings {
  return { maxThreads: maxThreads(), keepAliveMinutes: keepAliveMinutes(), worktreePool: worktreePoolSize(), defaultBackend: defaultBackend() };
}

// Each host setting's check and save. The check runs on every field before any is saved. The saves are arrows, so
// this table reads no setting until it runs (a route that mocks lib/settings loads this module too).
const HOST_FIELDS: Record<keyof HostSettings, { ok: (v: unknown) => boolean; says: string; save: (v: never) => void }> = {
  maxThreads: { ok: (v) => whole(v, MAX_THREADS_CEILING), says: `a whole number from 0 (no limit) to ${MAX_THREADS_CEILING}`, save: (v) => setMaxThreads(v) },
  keepAliveMinutes: { ok: (v) => whole(v, KEEP_ALIVE_MAX), says: "a number of minutes, 0 to a week", save: (v) => setKeepAliveMinutes(v) },
  worktreePool: { ok: (v) => whole(v, 3), says: "0 to 3", save: (v) => setWorktreePoolSize(v) },
  defaultBackend: { ok: isBackend, says: `one of ${BACKEND_IDS.join(", ")}`, save: (v) => setDefaultBackend(v) },
};

/** Saves a settings.put patch: only host settings, each checked first. Returns what the host now has. */
export function applyHostSettings(patch: unknown): HostSettings {
  if (patch !== undefined && (patch === null || typeof patch !== "object" || Array.isArray(patch))) throw new Error("Those settings aren't a list of fields.");
  const foreign = foreignSetting(patch);
  if (foreign) throw new Error(`${foreign.slice(0, 40)} isn't a setting a worker takes from the network.`);
  const fields = Object.entries((patch ?? {}) as Record<string, unknown>) as [keyof HostSettings, unknown][];
  for (const [field, value] of fields) {
    if (!HOST_FIELDS[field].ok(value)) throw new Error(`${field} must be ${HOST_FIELDS[field].says}.`);
  }
  for (const [field, value] of fields) HOST_FIELDS[field].save(value as never);
  return hostSettings();
}

export type AccountSnapshot = Partial<Record<AccountSetting, unknown>>;

/** This Mac's account settings, every field explicit, as they go to your account. */
export function accountSettings(): Record<AccountSetting, unknown> {
  return {
    automations: automations(),
    pushOnDone: pushOnDone(),
    doneModel: doneModel(),
    doneEffort: doneEffort(),
    subagentModel: subagentModel(),
    // "" is the default instructions, so a Mac that never changed them doesn't send Weft's own text.
    threadPrompt: settings().threadPrompt ?? "",
    backupModel: backupModel(),
    agents: agentsSnapshot(),
  };
}

// Each account setting's check (returning the value to save, or undefined to skip it) and save.
const ACCOUNT_FIELDS: Record<AccountSetting, { read: (v: unknown) => unknown; save: (v: never) => void }> = {
  automations: {
    read: (v) => {
      try {
        return readAutomations(v);
      } catch {
        return undefined;
      }
    },
    save: (v) => setAutomations(v),
  },
  pushOnDone: { read: (v) => (typeof v === "boolean" ? v : undefined), save: (v) => setPushOnDone(v) },
  doneModel: { read: (v) => (isModel(v) ? v : undefined), save: (v) => setDoneModel(v) },
  doneEffort: { read: (v) => (isEffort(v) ? v : undefined), save: (v) => setDoneEffort(v) },
  subagentModel: { read: (v) => (isSubagentModel(v) ? v : undefined), save: (v) => setSubagentModel(v) },
  threadPrompt: { read: (v) => (typeof v === "string" && v.length <= 32_000 ? v : undefined), save: (v) => setThreadPrompt(v) },
  backupModel: { read: (v) => (isModel(v) ? v : undefined), save: (v) => setBackupModel(v) },
  agents: { read: readAgentsSnapshot, save: (v) => applyAgentsSnapshot(v) },
};

/** Mirrors a synced snapshot into this host's settings: only account settings, each checked, changed ones written. */
export function applyAccountSettings(snapshot: unknown): AccountSetting[] {
  const now = accountSettings();
  const changed: AccountSetting[] = [];
  const picked = pickSettings(snapshot, ACCOUNT_SETTINGS);
  for (const field of ACCOUNT_SETTINGS) {
    const value = ACCOUNT_FIELDS[field].read(picked[field]);
    if (value === undefined || JSON.stringify(value) === JSON.stringify(now[field])) continue;
    ACCOUNT_FIELDS[field].save(value as never);
    changed.push(field);
  }
  return changed;
}
