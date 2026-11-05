// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  RECOVERY_CLIPBOARD_MS,
  RECOVERY_GRID_COLUMNS,
  RECOVERY_PASSPHRASE_MIN,
  RECOVERY_WORD_COUNT,
  looksLikeRecoveryKey,
  passphraseHint,
  passphraseIsLongEnough,
  recoveryGrid,
  recoveryLine,
  shownNote,
  vaultRecoveryBridge,
} from "./vault-recovery-view";

// The recovery key's rules, from the renderer's side (docs/architecture/teams-vault.md, "Recovery
// key"): the words are 24 of them, shown once, copied for a minute, and the passphrase is worth
// having.

const WORDS = Array.from({ length: RECOVERY_WORD_COUNT }, (_, i) => `word${i + 1}`);

describe("the recovery key's words", () => {
  it("are 24 of them, in a four-column grid", () => {
    expect(RECOVERY_WORD_COUNT).toBe(24);
    expect(RECOVERY_GRID_COLUMNS).toBe(4);
    const grid = recoveryGrid(WORDS);
    expect(grid).toHaveLength(24);
    expect(grid[0]).toEqual({ index: 1, word: "word1" });
    expect(grid[23]).toEqual({ index: 24, word: "word24" });
  });

  it("read in order, numbered, so a paste keeps the order visible", () => {
    const line = recoveryLine(WORDS);
    expect(line.startsWith("1. word1")).toBe(true);
    expect(line).toContain("12. word12");
    expect(line.endsWith("24. word24")).toBe(true);
  });

  it("are a whole key only when there are 24 of them", () => {
    expect(looksLikeRecoveryKey(WORDS)).toBe(true);
    expect(looksLikeRecoveryKey(WORDS.slice(0, 23))).toBe(false);
    expect(looksLikeRecoveryKey([...WORDS, "extra"])).toBe(false);
    expect(looksLikeRecoveryKey(WORDS.map((w, i) => (i === 3 ? "  " : w)))).toBe(false);
  });
});

describe("the clipboard", () => {
  it("keeps the words for a minute, the same as the vault's copy", () => {
    expect(RECOVERY_CLIPBOARD_MS).toBe(60_000);
  });
});

describe("the passphrase", () => {
  it("is optional, but worth having when it is there", () => {
    expect(passphraseIsLongEnough("")).toBe(false);
    expect(passphraseIsLongEnough("short")).toBe(false);
    expect(passphraseIsLongEnough("a passphrase that is long")).toBe(true);
    expect(RECOVERY_PASSPHRASE_MIN).toBe(12);
  });

  it("says what it wants, and that it isn't kept", () => {
    expect(passphraseHint("")).toContain("Optional");
    expect(passphraseHint("short")).toContain("12");
    expect(passphraseHint("a passphrase that is long")).toContain("not stored");
  });
});

describe("what the page says afterwards", () => {
  it("says a first show is the only copy", () => {
    expect(shownNote({ words: WORDS })).toContain("Write these down");
  });

  it("says a re-show made the old words stop working", () => {
    const note = shownNote({ words: WORDS, reshown: true });
    expect(note).toContain("no longer open");
    expect(note).toContain("new words");
  });
});

describe("the bridge", () => {
  it("is missing outside the desktop, where there is no vault key", () => {
    expect(vaultRecoveryBridge()).toBeNull();
  });

  it("is missing in a shell from before the recovery key", () => {
    (window as unknown as { weft: unknown }).weft = { vault: {} };
    expect(vaultRecoveryBridge()).toBeNull();
  });

  it("is there when the shell has both calls", () => {
    const recovery = { show: () => Promise.resolve({ words: WORDS }), status: () => Promise.resolve({ exists: true, deviceId: "d1", publicKey: "pk" }) };
    (window as unknown as { weft: unknown }).weft = { vault: { recovery } };
    expect(vaultRecoveryBridge()).toBe(recovery);
  });
});
