// A shared vault's recovery key, from the renderer's side (docs/architecture/teams-vault.md,
// "Recovery key"). The 24 words the user writes down, and the rules the page that shows them obeys.
//
// The words are made in Electron main, behind Touch ID: the vault's key only exists there, so the
// server can't derive them and the renderer can only ask for them. What crosses into the renderer
// is the 24 words and nothing else — no key, no sealed box, no passphrase.
//
// The rules this module holds, in one line each:
//   - the words are shown once: a re-show is a fresh key, so the old words stop working
//   - the clipboard holds them for a minute, then it's cleared (CLIPBOARD_MS)
//   - the passphrase is a passphrase: it never crosses a boundary and never sits in the URL
//
// The bridge's shape lives here rather than in lib/vault-view.ts, so the vault's own type doesn't
// grow a member for a page that only one caller uses.

/** How many words a recovery key has. */
export const RECOVERY_WORD_COUNT = 24;

/** The grid the words are shown in: four columns of six. */
export const RECOVERY_GRID_COLUMNS = 4;

/** How long the clipboard keeps the words, in milliseconds. The same minute the vault's copy uses. */
export const RECOVERY_CLIPBOARD_MS = 60_000;

/** What `bridge.recovery.show` answers. */
export interface RecoveryShowResult {
  // The 24 words, in order. The only copy of the private half.
  words: string[];
  // The server's row for the recovery device.
  deviceId?: string;
  // The vault key version the sealed box holds.
  keyVersion?: number;
  // True when this is a second show: the old words stopped working when these were made.
  reshown?: boolean;
  // When the key was made (ISO 8601).
  shownAt?: string;
}

/** What `bridge.recovery.show` answers when Touch ID said no. */
export interface RecoveryDenied {
  denied: true;
}

/** What `bridge.recovery.status` answers. */
export interface RecoveryStatus {
  // Whether the vault has a recovery key yet.
  exists: boolean;
  // The recovery device's row id, when there is one.
  deviceId: string | null;
  // Its public key, when there is one. Never the private half.
  publicKey: string | null;
  // Whether the vault is shared with a workspace at all.
  shared?: boolean;
}

/**
 * The shell's part of the vault bridge for the recovery page. Missing in a shell from before the
 * recovery key, and missing outside the desktop entirely — weft.zip has no vault key to derive
 * words from.
 */
export interface VaultRecoveryShell {
  recovery?: {
    show(vaultId: string, passphrase?: string): Promise<RecoveryShowResult | RecoveryDenied>;
    status(vaultId: string): Promise<RecoveryStatus>;
  };
}

/**
 * The recovery bridge, or null when the shell doesn't have one — the browser (weft.zip), and the
 * desktop app from before the recovery key. The cast is one narrow place: the vault bridge's own
 * type (lib/vault-view.ts) doesn't name these calls.
 */
export function vaultRecoveryBridge(): VaultRecoveryShell["recovery"] | null {
  if (typeof window === "undefined") return null;
  const vault = (window as { weft?: { vault?: Partial<VaultRecoveryShell> } }).weft?.vault;
  const recovery = vault?.recovery;
  if (!recovery || typeof recovery.show !== "function" || typeof recovery.status !== "function") return null;
  return recovery;
}

/**
 * The words as a grid: four columns of six, numbered 1 to 24.
 *
 * The number is part of the display, not of the key: the words are the key, and the order matters.
 * A user reading them off the screen writes the words; the numbers are there so a word that's been
 * misread can be pointed at.
 */
export function recoveryGrid(words: string[]): { index: number; word: string }[] {
  return words.map((word, i) => ({ index: i + 1, word }));
}

/**
 * The words as one line, for the clipboard: numbered and space-separated, so a paste back into
 * Weft keeps the order visible.
 */
export function recoveryLine(words: string[]): string {
  return words.map((word, i) => `${i + 1}. ${word}`).join(" ");
}

/**
 * Whether a set of words is a whole recovery key: 24 of them, all in the list.
 *
 * This is a shape check, not a validity check — it can't tell a typo from a wrong word until the
 * words are turned back into a key and the sealed box refuses to open.
 */
export function looksLikeRecoveryKey(words: string[]): boolean {
  return words.length === RECOVERY_WORD_COUNT && words.every((w) => typeof w === "string" && w.trim() !== "");
}

/**
 * The passphrase's own check, for the page's form: a passphrase has to be long enough to matter.
 *
 * Twelve characters is the floor and nothing more: the passphrase sits between the words and the
 * key (scrypt(passphrase, vault_id)), so it is worth having, but a rule that pushes people towards
 * a phrase they can remember beats a rule that pushes them towards "Password1!".
 */
export const RECOVERY_PASSPHRASE_MIN = 12;

/** Whether a passphrase is long enough to be worth having. */
export function passphraseIsLongEnough(passphrase: string): boolean {
  return passphrase.trim().length >= RECOVERY_PASSPHRASE_MIN;
}

/** What the passphrase field says when it isn't long enough. */
export function passphraseHint(passphrase: string): string {
  if (!passphrase) return "Optional. The words alone open the vault without it.";
  if (!passphraseIsLongEnough(passphrase)) return `At least ${RECOVERY_PASSPHRASE_MIN} characters, please.`;
  return "The passphrase is not stored anywhere, and it is never sent to weft.zip.";
}

/**
 * The line that tells the user what just happened, in the drawer's plain voice.
 *
 * A first show and a re-show say different things, because they are different: a re-show revoked
 * the old key, and the user has to know that the words they wrote down last time no longer work.
 */
export function shownNote(result: RecoveryShowResult): string {
  if (result.reshown) {
    return "These are new words. The ones you wrote down before no longer open this vault — this is what a re-show does, so only one set of words is ever live.";
  }
  return "Write these down. Weft won't keep them: they aren't stored, and asking again makes a new set.";
}
