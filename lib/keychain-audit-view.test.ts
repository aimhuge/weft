import { describe, expect, it } from "vitest";
import { auditNote, auditSentence, auditVia, gapLine, grantLeft, mergeLog, seqGaps, syncLine, type AuditEntry, type VaultGrant } from "./keychain-audit-view";

// The sentences the Keychain access card and the card menu read (lib/keychain-audit-view.ts).

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return { id: "e1", at: "2026-10-26T00:00:00.000Z", kind: "vault", action: "fill", outcome: "ok", by: "you", ...over };
}

describe("auditSentence", () => {
  it("reads a Keychain open as Weft opening the item in the Keychain", () => {
    expect(auditSentence(entry({ kind: "keychain", action: "open", by: "weft", what: "vault key" }))).toBe("Weft opened the vault key in the Keychain");
    // No name for the item: the Keychain itself.
    expect(auditSentence(entry({ kind: "keychain", action: "seal", by: "weft" }))).toBe("Weft sealed the Keychain in the Keychain");
  });

  it("counts repeats: once more, and many more", () => {
    expect(auditSentence(entry({ kind: "keychain", action: "open", by: "weft", what: "vault key", count: 1 }))).toBe("Weft opened the vault key 1 more time");
    expect(auditSentence(entry({ kind: "keychain", action: "open", by: "weft", what: "vault key", count: 4 }))).toBe("Weft opened the vault key 4 more times");
    // An unknown action falls back to the action's own text.
    expect(auditSentence(entry({ kind: "keychain", action: "peek", by: "weft", what: "vault key", count: 2 }))).toBe("Weft peek the vault key 2 more times");
    // Without a name, the item is a Keychain item.
    expect(auditSentence(entry({ kind: "keychain", action: "open", by: "weft", count: 2 }))).toBe("Weft opened the Keychain item 2 more times");
  });

  it("names who did it: you, a thread with a title, an app, Weft", () => {
    expect(auditSentence(entry({ action: "reveal", by: "you" }))).toBe("You revealed secrets");
    expect(auditSentence(entry({ action: "reveal", by: "thread", thread: "Fix login" }))).toBe("“Fix login” revealed secrets");
    expect(auditSentence(entry({ action: "reveal", by: "thread" }))).toBe("A thread revealed secrets");
    expect(auditSentence(entry({ action: "reveal", by: "app" }))).toBe("An app revealed secrets");
    expect(auditSentence(entry({ action: "reveal", by: "weft" }))).toBe("Weft revealed secrets");
    // Any other actor is Weft.
    expect(auditSentence(entry({ action: "reveal", by: "someone-else" }))).toBe("Weft revealed secrets");
  });

  it("reads a fill into a site, and a run of a command", () => {
    expect(auditSentence(entry({ action: "fill", names: ["STRIPE_KEY"], site: "dashboard.stripe.com" }))).toBe("You typed STRIPE_KEY into dashboard.stripe.com");
    expect(auditSentence(entry({ action: "run", command: "pnpm test", names: ["API_KEY"] }))).toBe("You ran a command with API_KEY: pnpm test");
    // A send has no where, and neither has an ask.
    expect(auditSentence(entry({ action: "send", names: ["A"], site: "x.com" }))).toBe("You sent A into x.com");
  });

  it("names both parties in a grant and a revoke", () => {
    expect(auditSentence(entry({ action: "grant", by: "you", thread: "Fix login", vault: "aimhuge/weft" }))).toBe("You gave “Fix login” an hour of access to the aimhuge/weft vault");
    expect(auditSentence(entry({ action: "revoke", by: "you", thread: "Fix login", vault: "aimhuge/weft" }))).toBe("You took back “Fix login”'s access to the aimhuge/weft vault");
    // A thread that asked for its own grant: the yes was yours.
    expect(auditSentence(entry({ action: "grant", by: "thread", thread: "Fix login", vault: "aimhuge/weft" }))).toBe("“Fix login” got an hour of access to the aimhuge/weft vault");
    expect(auditSentence(entry({ action: "grant", by: "thread", thread: "Fix login", vault: "aimhuge/weft", detail: "to fill the dashboard" }))).toBe(
      "“Fix login” got an hour of access to the aimhuge/weft vault (to fill the dashboard)",
    );
    // No thread named: a thread.
    expect(auditSentence(entry({ action: "grant", by: "you", vault: "aimhuge/weft" }))).toBe("You gave a thread an hour of access to the aimhuge/weft vault");
    // No vault named: the project.
    expect(auditSentence(entry({ action: "grant", by: "you", thread: "Fix login" }))).toBe("You gave “Fix login” an hour of access to the project vault");
    expect(auditSentence(entry({ action: "revoke", by: "you" }))).toBe("You took back a thread's access to the project vault");
  });

  it("reads an ask as a request for Touch ID, or for what it asked about", () => {
    expect(auditSentence(entry({ action: "ask", by: "thread", thread: "Fix login" }))).toBe("“Fix login” asked for Touch ID");
    expect(auditSentence(entry({ action: "ask", by: "thread", thread: "Fix login", detail: "STRIPE_KEY" }))).toBe("“Fix login” asked STRIPE_KEY");
  });

  it("cuts the names to three and counts the rest", () => {
    expect(auditSentence(entry({ action: "fill", names: ["A", "B"], site: "x.com" }))).toBe("You typed A, B into x.com");
    expect(auditSentence(entry({ action: "fill", names: ["A", "B", "C"], site: "x.com" }))).toBe("You typed A, B, C into x.com");
    expect(auditSentence(entry({ action: "fill", names: ["A", "B", "C", "D", "E"], site: "x.com" }))).toBe("You typed A, B, C +2 into x.com");
    // The vault in brackets.
    expect(auditSentence(entry({ action: "copy", names: ["A"], vault: "aimhuge/weft" }))).toBe("You copied A (aimhuge/weft)");
    // No names: secrets.
    expect(auditSentence(entry({ action: "copy" }))).toBe("You copied secrets");
  });

  it("adds the line's own note as small print", () => {
    expect(auditSentence(entry({ action: "reveal", detail: "for the deploy" }))).toBe("You revealed secrets · for the deploy");
    // A grant you gave says who it was for, not the note again.
    expect(auditSentence(entry({ action: "grant", by: "you", thread: "Fix login", vault: "v", detail: "for the deploy" }))).toBe("You gave “Fix login” an hour of access to the v vault");
    // An unknown action falls back to the action's own text.
    expect(auditSentence(entry({ action: "peek" }))).toBe("You peek secrets");
  });

  it("says how it ended: denied, missing, error", () => {
    expect(auditSentence(entry({ action: "fill", names: ["K"], site: "x.com", outcome: "denied" }))).toBe("Denied: You typed K into x.com");
    expect(auditSentence(entry({ action: "fill", names: ["K"], site: "x.com", outcome: "missing" }))).toBe("You typed K into x.com, but it has no value");
    expect(auditSentence(entry({ action: "fill", names: ["K"], site: "x.com", outcome: "error" }))).toBe("You typed K into x.com failed");
    expect(auditSentence(entry({ action: "fill", names: ["K"], site: "x.com", outcome: "error", detail: "no field" }))).toBe("You typed K into x.com failed: no field");
  });
});

describe("auditVia", () => {
  it("names how it was allowed, or says nothing", () => {
    expect(auditVia(entry({ via: "grant" }))).toBe("standing access");
    expect(auditVia(entry({ via: "touch-id" }))).toBe("Touch ID");
    expect(auditVia(entry({ via: "unlocked" }))).toBe("already approved");
    expect(auditVia(entry({ via: "rule" }))).toBe("Always allow");
    expect(auditVia(entry({ via: "once" }))).toBe("Allow once");
    expect(auditVia(entry({ via: "always" }))).toBe("Always allow");
    // An unknown way is said as it was.
    expect(auditVia(entry({ via: "mystery" }))).toBe("mystery");
    expect(auditVia(entry())).toBe(null);
  });
});

describe("grantLeft", () => {
  it("counts the minutes left, and says ending when it's nearly over", () => {
    const grant = (until: number): VaultGrant => ({ card: "c1", id: "g1", label: "Fix login", at: 0, until });
    const now = Date.UTC(2026, 9, 26, 12, 0, 0);
    expect(grantLeft(grant(now + 42 * 60_000), now)).toBe("42 min left");
    expect(grantLeft(grant(now + 2 * 60_000), now)).toBe("2 min left");
    expect(grantLeft(grant(now + 60_000), now)).toBe("ending");
    expect(grantLeft(grant(now + 30_000), now)).toBe("ending");
    expect(grantLeft(grant(now - 60_000), now)).toBe("ending");
  });
});

describe("whose line it is", () => {
  it("names the account behind a thread, and you by name", () => {
    expect(auditSentence(entry({ by: "thread", thread: "Set up Stripe webhooks", names: ["STRIPE_SECRET_KEY"], vault: "aimhuge/weft", site: "dashboard.stripe.com", owner: "Alex Miller" }))).toBe(
      "Alex Miller's thread “Set up Stripe webhooks” typed STRIPE_SECRET_KEY (aimhuge/weft) into dashboard.stripe.com",
    );
    expect(auditSentence(entry({ by: "thread", owner: "Alex Miller" }))).toBe("Alex Miller's thread typed secrets");
    expect(auditSentence(entry({ by: "you", action: "reveal", names: ["A"], owner: "Alex Miller" }))).toBe("Alex Miller revealed A");
  });

  it("names whose thread got or lost a grant", () => {
    expect(auditSentence(entry({ action: "grant", by: "thread", thread: "Fix login", vault: "v", owner: "Alex" }))).toBe("Alex's thread “Fix login” got an hour of access to the v vault");
    expect(auditSentence(entry({ action: "grant", by: "you", thread: "Fix login", vault: "v", owner: "Alex" }))).toBe("Alex gave “Fix login” an hour of access to the v vault");
  });
});

describe("auditNote", () => {
  it("marks a line still on the Mac, and one that reached the account late", () => {
    expect(auditNote(entry())).toBe("waiting on this Mac");
    expect(auditNote(entry({ savedAt: "2026-10-26T00:00:05.000Z" }))).toBeNull();
    expect(auditNote(entry({ savedAt: "2026-10-26T00:25:00.000Z" }))).toBe("reached your account 25 min later");
    expect(auditNote(entry({ savedAt: "2026-10-26T03:00:00.000Z" }))).toBe("reached your account 3 h later");
    expect(auditNote(entry({ savedAt: "2026-10-29T00:00:00.000Z" }))).toBe("reached your account 3 d later");
  });
});

describe("mergeLog", () => {
  it("puts the account's lines and the waiting ones in one list, newest first, each once", () => {
    const saved = [entry({ id: "a", at: "2026-10-26T00:00:02.000Z", savedAt: "2026-10-26T00:00:03.000Z" })];
    const waiting = [entry({ id: "a", at: "2026-10-26T00:00:02.000Z" }), entry({ id: "b", at: "2026-10-26T00:00:09.000Z" }), entry({ id: "c", at: "2026-10-26T00:00:01.000Z" })];
    const merged = mergeLog(saved, waiting, "Alex");
    expect(merged.map((e) => e.id)).toEqual(["b", "a", "c"]);
    expect(merged[0]?.owner).toBe("Alex");
    expect(merged[1]?.savedAt).toBeDefined();
    // Signed out: no name to give the waiting lines.
    expect(mergeLog([], waiting, null)[0]?.owner).toBeUndefined();
  });
});

describe("seqGaps", () => {
  it("finds numbers a Mac skipped, per Mac, under the line after the gap", () => {
    const lines = [
      entry({ id: "m1-5", device: "m1", seq: 5 }),
      entry({ id: "m1-1", device: "m1", seq: 1 }),
      entry({ id: "m1-2", device: "m1", seq: 2 }),
      entry({ id: "m2-7", device: "m2", seq: 7 }),
      entry({ id: "m2-8", device: "m2", seq: 8 }),
      entry({ id: "waiting", seq: 9 }),
    ];
    expect([...seqGaps(lines)]).toEqual([["m1-5", 2]]);
    expect(gapLine(1)).toBe("1 line from this Mac never reached your account");
    expect(gapLine(2)).toBe("2 lines from this Mac never reached your account");
  });
});

describe("syncLine", () => {
  it("says the log is kept in your account, when it last uploaded, and what waits", () => {
    const time = (iso: string) => new Date(iso).toISOString();
    expect(syncLine({ signedIn: true, waiting: 0, syncedAt: "2026-10-26T00:00:00.000Z" }, time)).toBe("Kept in your Weft account · last upload 2026-10-26T00:00:00.000Z");
    expect(syncLine({ signedIn: true, waiting: 3, syncedAt: null }, time)).toBe("Kept in your Weft account · 3 waiting to upload");
    // Signed out: the log waits on the Mac until you sign in.
    expect(syncLine({ signedIn: false, waiting: 0, syncedAt: null }, time)).toBe("Sign in to Weft to keep this log in your account. Until then it waits on this Mac");
    expect(syncLine({ signedIn: false, waiting: 2, syncedAt: null }, time)).toBe("Sign in to Weft to keep this log in your account. Until then it waits on this Mac · 2 waiting to upload");
  });
});
