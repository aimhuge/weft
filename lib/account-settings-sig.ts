// Your account's settings travel to a Weft Worker signed by your Mac (docs/architecture/project-hosts.md#settings-on-a-worker-wp3).
// The account_settings row is writable by any session of yours (weft.zip, the phone, a stolen one), and the thread
// instructions and automations it carries shape every card on the worker, so a worker applies a row only when the Mac
// it was paired with signed it: the key that came in the pairing code (lib/worker-mac-keys.ts), never one off the network.
// Main signs with that same device key (electron/settings-sign.cjs), on each push, with no Touch ID: the message is
// domain-separated, so the signature means only "this Mac's settings at this version" and can't stand for an approval or
// a secret_use. The version only grows, so an older signed row put back can't roll a worker's settings back.
import { createHash } from "node:crypto";
import { macSigned } from "./worker-mac-keys";

export const SETTINGS_SIG_PREFIX = "weft-account-settings-v1";

// JSON with every object's keys sorted, so the Mac and the worker hash the same text whatever order jsonb hands back.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  return value === undefined ? "null" : JSON.stringify(value);
}

export const settingsDigest = (settings: unknown): string => createHash("sha256").update(canonicalJson(settings)).digest("hex");

// What main signs (electron/settings-sign.cjs accountSettingsMessage is the same, checked by a test).
export function accountSettingsMessage(userId: string, version: number, digest: string): string {
  return [SETTINGS_SIG_PREFIX, userId, String(version), digest].join("\n");
}

// A row as worker_account_settings returns it.
export interface SignedSettingsRow {
  user_id?: unknown;
  settings: unknown;
  version?: unknown;
  signature?: unknown;
  updated_at: string;
}

/** Why a worker won't apply this row, or null when the Mac it trusts signed it and it's newer than what it has. */
export function settingsRefusal(row: SignedSettingsRow, macKeys: string[], lastVersion: number): string | null {
  if (!macKeys.length) return "this worker trusts no Mac (enrolled by token); pair it from Settings → Devices to take your settings";
  const { user_id: user, version, signature } = row;
  if (typeof signature !== "string" || !signature) return "the row isn't signed by your Mac";
  if (typeof user !== "string" || typeof version !== "number" || !Number.isSafeInteger(version) || version <= 0) return "the row's signature names no version";
  if (version <= lastVersion) return "the row is older than the settings this worker has";
  const message = accountSettingsMessage(user, version, settingsDigest(row.settings));
  return macKeys.some((key) => macSigned(key, message, signature)) ? null : "the row's signature isn't your Mac's";
}
