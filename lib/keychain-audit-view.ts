// What Settings → Security's Keychain access card and the card menu read (docs/architecture/secrets.md#audit-log):
// the audit log's lines as your Weft account keeps them (lib/keychain-audit-record.ts) plus those still waiting on
// the Mac (electron/keychain-audit.cjs), the threads with standing access from
// electron/vault-grants.cjs, and the sentence each line reads as. Names and events only, never a value.
//
// The shapes themselves live in lib/keychain-audit-types.ts, which the record, the sync and this view all read.
import type { AuditEntry, VaultGrant } from "./keychain-audit-types";

export type { AuditActivity, AuditEntry, GrantResult, KeychainBridge, VaultGrant } from "./keychain-audit-types";

// A thread named with whose it is when the line knows: "Alex's thread “Fix login”".
function threadOf(e: AuditEntry): string {
  const title = e.thread ? `“${e.thread}”` : "";
  if (e.owner) return [`${e.owner}'s thread`, title].filter(Boolean).join(" ");
  return title || "a thread";
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// Who did it, as the start of the sentence: the account's name when the line has it.
function who(e: AuditEntry): string {
  if (e.by === "you") return e.owner ?? "You";
  if (e.by === "thread") return capital(threadOf(e));
  if (e.by === "app") return "An app";
  return "Weft";
}

const VERBS: Record<string, string> = {
  open: "opened",
  seal: "sealed",
  reveal: "revealed",
  copy: "copied",
  fill: "typed",
  run: "ran a command with",
  "dev server": "started a dev server with",
  send: "sent",
  read: "read",
  set: "set",
  "add blank": "added the blank",
  import: "imported",
  "copy to": "copied",
  remove: "removed",
  "write .env.local": "wrote .env.local with",
  grant: "gave",
  revoke: "took back",
  ask: "asked",
};

// The names a line is about, cut to a few.
function namesOf(e: AuditEntry): string {
  const names = e.names ?? [];
  if (!names.length) return "";
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} +${String(names.length - 3)}` : names.join(", ");
}

// The thing acted on: a Keychain item, a vault's names, or a vault itself for a grant.
function objectOf(e: AuditEntry): string {
  if (e.kind === "keychain") return `the ${e.what ?? "Keychain"} in the Keychain`;
  if (e.action === "ask") return e.detail ?? "for Touch ID";
  const names = namesOf(e);
  return [names || "secrets", e.vault ? `(${e.vault})` : ""].filter(Boolean).join(" ");
}

// Where it went: a site, a command, or the line's own note.
function whereOf(e: AuditEntry): string {
  if (e.site) return ` into ${e.site}`;
  if (e.command) return `: ${e.command}`;
  if (e.action === "send" || e.action === "ask") return "";
  return e.detail ? ` · ${e.detail}` : "";
}

const VIA: Record<string, string> = { grant: "standing access", "touch-id": "Touch ID", unlocked: "already approved", rule: "Always allow", once: "Allow once", always: "Always allow" };

// A grant or revoke names two parties: who did it and the thread it was for. A thread that asked for its own
// grant reads "Alex's thread “Fix login” got access to…", since the yes was yours.
function grantSentence(e: AuditEntry): string {
  const thread = e.thread ? `“${e.thread}”` : "a thread";
  const vault = `the ${e.vault ?? "project"} vault`;
  if (e.action === "grant" && e.by === "thread") return `${who(e)} got an hour of access to ${vault}${e.detail ? ` (${e.detail})` : ""}`;
  return e.action === "grant" ? `${who(e)} gave ${thread} an hour of access to ${vault}` : `${who(e)} took back ${thread}'s access to ${vault}`;
}

/** One line of the log as a sentence: "Alex's thread “Fix login” typed STRIPE_KEY (o/r) into dashboard.stripe.com". */
export function auditSentence(e: AuditEntry): string {
  if (e.count) return `Weft ${VERBS[e.action] ?? e.action} the ${e.what ?? "Keychain item"} ${String(e.count)} more time${e.count === 1 ? "" : "s"}`;
  const verb = VERBS[e.action] ?? e.action;
  const grant = e.action === "grant" || e.action === "revoke";
  const sentence = grant ? grantSentence(e) : `${who(e)} ${verb} ${objectOf(e)}${whereOf(e)}`;
  if (e.outcome === "denied") return `Denied: ${sentence}`;
  if (e.outcome === "missing") return `${sentence}, but it has no value`;
  if (e.outcome === "error") return `${sentence} failed${e.detail ? `: ${e.detail}` : ""}`;
  return sentence;
}

/** How it was allowed, for the line's small print, or null. */
export const auditVia = (e: AuditEntry) => (e.via ? (VIA[e.via] ?? e.via) : null);

/** "in 42 min" or "ending" for a grant. */
export function grantLeft(g: VaultGrant, now = Date.now()): string {
  const min = Math.ceil((g.until - now) / 60_000);
  return min <= 1 ? "ending" : `${String(min)} min left`;
}

// A line that reached the database this long after it happened was held back (signed out, offline, or kept).
const LATE_MS = 10 * 60_000;

// "3 h", "25 min", "2 d".
function span(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${String(min)} min`;
  const hours = Math.round(min / 60);
  return hours < 48 ? `${String(hours)} h` : `${String(Math.round(hours / 24))} d`;
}

/** The line's small print about the record: still on this Mac, or how late it reached your account. */
export function auditNote(e: AuditEntry): string | null {
  if (!e.savedAt) return "waiting on this Mac";
  const late = Date.parse(e.savedAt) - Date.parse(e.at);
  return late > LATE_MS ? `reached your account ${span(late)} later` : null;
}

/** Your account's lines and the ones still waiting on the Mac as one list, newest first, each line once. */
export function mergeLog(saved: AuditEntry[], waiting: AuditEntry[], owner: string | null): AuditEntry[] {
  const ids = new Set(saved.map((e) => e.id));
  const local = waiting.filter((e) => !ids.has(e.id)).map((e) => (owner ? { ...e, owner } : e));
  return [...saved, ...local].sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Lines a Mac numbered that never reached your account: for each saved line, how many numbers are missing just
 * before it on its Mac. Keyed by the line's id, so Settings shows the gap under it (the list is newest first).
 */
export function seqGaps(entries: AuditEntry[]): Map<string, number> {
  const byDevice = new Map<string, { id: string; seq: number }[]>();
  for (const { id, seq, device } of entries) {
    if (!device || !seq) continue;
    byDevice.set(device, [...(byDevice.get(device) ?? []), { id, seq }]);
  }
  const gaps = new Map<string, number>();
  for (const lines of byDevice.values()) {
    lines.sort((a, b) => a.seq - b.seq);
    // The first line's number is where the window starts, not a gap.
    let last = Infinity;
    for (const line of lines) {
      if (line.seq - last > 1) gaps.set(line.id, line.seq - last - 1);
      last = line.seq;
    }
  }
  return gaps;
}

/** The gap's own line: "2 lines from this Mac never reached your account". */
export const gapLine = (missing: number) => `${String(missing)} line${missing === 1 ? "" : "s"} from this Mac never reached your account`;

/** Where the log is kept, under it: your account, or the Mac until you sign in, and what waits to upload. */
export function syncLine(a: { signedIn: boolean; waiting: number; syncedAt: string | null }, time: (iso: string) => string): string {
  const waiting = a.waiting ? ` · ${String(a.waiting)} waiting to upload` : "";
  if (!a.signedIn) return `Sign in to Weft to keep this log in your account. Until then it waits on this Mac${waiting}`;
  return `Kept in your Weft account${a.syncedAt ? ` · last upload ${time(a.syncedAt)}` : ""}${waiting}`;
}
