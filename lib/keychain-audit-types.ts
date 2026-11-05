// The shapes the Keychain audit log is made of, shared by everyone who writes or reads a line: the log's own
// modules (lib/keychain-audit-record.ts, lib/keychain-audit-sync.ts), the view that reads them as sentences
// (lib/keychain-audit-view.ts), and the vault bridge the desktop shell exposes (electron/preload.cjs).
// Names and events only, never a value.

/** One line of the audit log, as electron/keychain-audit.cjs writes it. */
export type AuditEntry = {
  id: string;
  // This Mac's number for the line (a gap is a line that never reached your account).
  seq?: number;
  at: string;
  kind: "keychain" | "vault";
  action: string;
  outcome: string;
  by: string;
  count?: number;
  what?: string;
  card?: string;
  thread?: string;
  vault?: string;
  names?: string[];
  environment?: string;
  site?: string;
  command?: string;
  detail?: string;
  via?: string;
  // Read back from your Weft account (lib/keychain-audit-record.ts): whose line it is, the Mac it came from and
  // when the database got it. A line still waiting on the Mac has none of these.
  owner?: string;
  device?: string;
  savedAt?: string;
};

/** A thread's standing access to one vault (electron/vault-grants.cjs); at and until are epoch ms. */
export type VaultGrant = { card: string; thread?: string; id: string; label: string; at: number; until: number };

/** What the account has: whether you're signed in, the name lines read as, and the lines newest first. */
export type KeychainRecord = { signedIn: boolean; owner: string | null; entries: AuditEntry[] };

/** vault:activity: the newest lines, how many wait to upload to your Weft account, and when the last upload landed. */
export type AuditActivity = { entries: AuditEntry[]; waiting: number; syncedAt: string | null };

export type GrantResult = { granted?: boolean; denied?: boolean; label: string; until?: number };

/** The vault bridge's grant and log calls (electron/preload.cjs). Missing in older shells. */
export interface KeychainBridge {
  grants?: () => Promise<VaultGrant[]>;
  grant?: (folder: string, card: string, thread?: string) => Promise<GrantResult>;
  revoke?: (card: string, id?: string) => Promise<{ revoked: number }>;
  activity?: (limit?: number) => Promise<AuditActivity>;
}
