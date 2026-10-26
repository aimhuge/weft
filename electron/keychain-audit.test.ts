// The audit log of every Keychain and vault access (electron/keychain-audit.cjs): one JSON line per event, 0600,
// a per-Mac seq, an outbox whose lines are deleted once uploaded, with Electron's safeStorage wrapper in
// keychain-audit-keychain.test.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { audit, auditOutbox, auditStatus, configureAudit, createAuditLog, markAuditSynced, readAudit, resetAudit } from "./keychain-audit.cjs";

// One line of the log, as the module writes it. A field may come in empty (null or undefined) and be dropped.
type AuditEntry = {
  id: string;
  seq?: number;
  at: string;
  kind?: "keychain" | "vault";
  action: string;
  outcome?: string;
  by?: string;
  count?: number;
  what?: string;
  card?: string;
  thread?: string;
  vault?: string;
  names?: string[];
  detail?: string | null;
};

// The log's own shape: the .cjs module is untyped JavaScript, so it's named here.
type AuditLog = {
  record: (entry: Partial<AuditEntry>) => AuditEntry;
  read: (limit?: number) => AuditEntry[];
  outbox: (limit?: number) => AuditEntry[];
  markSynced: (id: string) => void;
  status: () => { waiting: number; syncedAt: string | null };
};

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "weft-audit-"));

// The ids are UUIDs, so a line's id is the shape the sync cursor expects.
const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}` as const;

// A log in its own temp folder, with predictable ids and a fixed clock.
function make({ maxEntries = 5000, keepEntries = 4000, at = Date.UTC(2026, 0, 2, 3, 4, 5) } = {}) {
  const dir = tmp();
  const file = path.join(dir, "vault", "audit.jsonl");
  let n = 0;
  const log = createAuditLog({ file, now: () => at, maxEntries, keepEntries, randomId: () => uuid(++n) }) as AuditLog;
  return { dir, file, log, cursorFile: path.join(dir, "vault", "audit-synced.json"), seqFile: path.join(dir, "vault", "audit-seq.json") };
}

// The actions of the lines a call gave back.
const actions = (entries: AuditEntry[]) => entries.map((e) => e.action);

describe("createAuditLog", () => {
  it("adds an id and a timestamp to every line and drops the empty fields", () => {
    const { file, log } = make();
    const line = log.record({ kind: "vault", action: "reveal", outcome: "ok", vault: "o/r", card: "", thread: undefined, detail: null, names: [] });
    expect(line.id).toBe(uuid(1));
    expect(line.at).toBe("2026-01-02T03:04:05.000Z");
    expect(line).toEqual({ id: uuid(1), seq: 1, at: "2026-01-02T03:04:05.000Z", kind: "vault", action: "reveal", outcome: "ok", vault: "o/r" });
    expect(JSON.parse(fs.readFileSync(file, "utf8").trim())).toEqual(line);
    expect(log.record({ kind: "vault", action: "typed", names: ["A", "B"] }).names).toEqual(["A", "B"]);
  });

  it("cuts a long string to 300 characters and a long array to 50 names", () => {
    const { log } = make();
    const names = Array.from({ length: 80 }, (_, i) => `NAME_${i}`);
    const line = log.record({ detail: "x".repeat(500), names });
    expect(line.detail).toHaveLength(300);
    expect(line.names).toHaveLength(50);
    expect(line.names![0]).toBe("NAME_0");
    expect(line.names![49]).toBe("NAME_49");
  });

  it("keeps a number as it is", () => {
    const { log } = make();
    expect(log.record({ action: "open", count: 3 }).count).toBe(3);
  });

  it("keeps the log file private to the user", () => {
    const { file, log } = make();
    log.record({ action: "open" });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
  });

  it("reads the newest lines first, at most the limit asked for", () => {
    const { log } = make();
    log.record({ action: "a" });
    log.record({ action: "b" });
    log.record({ action: "c" });
    expect(actions(log.read())).toEqual(["c", "b", "a"]);
    expect(actions(log.read(2))).toEqual(["c", "b"]);
  });

  it("skips a line that doesn't parse", () => {
    const { file, log } = make();
    log.record({ action: "a" });
    fs.appendFileSync(file, "not json\n");
    log.record({ action: "b" });
    expect(actions(log.read())).toEqual(["b", "a"]);
  });

  it("keeps the newest entries once it grows past the maximum", () => {
    const { file, log } = make({ maxEntries: 3, keepEntries: 2 });
    log.record({ action: "a" });
    log.record({ action: "b" });
    log.record({ action: "c" });
    log.record({ action: "d" });
    const kept = fs
      .readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((l) => (JSON.parse(l) as { action: string }).action);
    expect(kept).toEqual(["c", "d"]);
    expect(actions(log.read())).toEqual(["d", "c"]);
  });

  it("numbers each line, and keeps counting after the uploaded lines are deleted", () => {
    const { log, seqFile } = make();
    log.record({ action: "a" });
    log.record({ action: "b" });
    log.markSynced(uuid(2));
    expect(log.record({ action: "c" }).seq).toBe(3);
    expect(JSON.parse(fs.readFileSync(seqFile, "utf8"))).toEqual({ seq: 3 });
    expect(fs.statSync(seqFile).mode & 0o777).toBe(0o600);
  });

  it("picks the count up from the outbox when the counter file is lost", () => {
    const { log, seqFile } = make();
    log.record({ action: "a" });
    log.record({ action: "b" });
    fs.rmSync(seqFile);
    expect(log.record({ action: "c" }).seq).toBe(3);
  });

  it("hands over the oldest lines and deletes them from the Mac once they're uploaded", () => {
    const { file, log } = make();
    log.record({ action: "a" });
    log.record({ action: "b" });
    log.record({ action: "c" });
    expect(actions(log.outbox())).toEqual(["a", "b", "c"]);
    expect(actions(log.outbox(1))).toEqual(["a"]);
    log.markSynced(uuid(1));
    expect(actions(log.outbox())).toEqual(["b", "c"]);
    expect(fs.readFileSync(file, "utf8")).not.toContain(uuid(1));
    log.markSynced(uuid(3));
    expect(log.outbox()).toEqual([]);
    expect(fs.readFileSync(file, "utf8")).toBe("");
  });

  it("deletes nothing for an id the outbox doesn't have", () => {
    const { log } = make();
    log.record({ action: "a" });
    log.record({ action: "b" });
    log.markSynced("id-cut-away");
    expect(actions(log.outbox())).toEqual(["a", "b"]);
  });

  it("notes when the last upload landed and says what is waiting", () => {
    const { log, cursorFile } = make();
    log.record({ action: "a" });
    log.record({ action: "b" });
    expect(log.status()).toEqual({ waiting: 2, syncedAt: null });
    log.markSynced(uuid(1));
    expect(JSON.parse(fs.readFileSync(cursorFile, "utf8"))).toEqual({ at: "2026-01-02T03:04:05.000Z" });
    expect(fs.statSync(cursorFile).mode & 0o777).toBe(0o600);
    expect(log.status()).toEqual({ waiting: 1, syncedAt: "2026-01-02T03:04:05.000Z" });
  });

  it("doesn't throw when the file can't be written", () => {
    const dir = tmp();
    const log = createAuditLog({ file: path.join(dir, "audit.jsonl"), now: () => 0, randomId: () => uuid(1) }) as AuditLog;
    // A file where the folder should be: mkdir fails, so the line is lost but the action goes on.
    fs.writeFileSync(path.join(dir, "blocked"), "x");
    const blocked = createAuditLog({ file: path.join(dir, "blocked", "audit.jsonl"), now: () => 0, randomId: () => uuid(1) }) as AuditLog;
    expect(() => blocked.record({ action: "open" })).not.toThrow();
    expect(blocked.read()).toEqual([]);
    expect(log.record({ action: "open" }).id).toBe(uuid(1));
  });
});

describe("the shared audit log", () => {
  beforeEach(() => resetAudit());
  afterEach(() => resetAudit());

  it("keeps events recorded before it's configured, then flushes them into the file", () => {
    expect(audit({ kind: "vault", action: "early" })).toBeNull();
    expect(readAudit()).toEqual([]);
    expect(auditOutbox()).toEqual([]);
    expect(auditStatus()).toEqual({ waiting: 0, syncedAt: null });

    const dir = tmp();
    configureAudit({ dataDir: dir, now: () => Date.UTC(2026, 0, 2) });
    const entries = readAudit() as AuditEntry[];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "vault", action: "early", at: "2026-01-02T00:00:00.000Z" });
    expect(fs.existsSync(path.join(dir, "vault", "audit.jsonl"))).toBe(true);
  });

  it("records, reads, hands over and syncs once configured", () => {
    const dir = tmp();
    configureAudit({ dataDir: dir, now: () => Date.UTC(2026, 0, 2) });
    audit({ kind: "vault", action: "reveal", outcome: "ok", vault: "o/r" });
    const entries = readAudit() as AuditEntry[];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "vault", action: "reveal", outcome: "ok", vault: "o/r" });
    expect(actions(auditOutbox() as AuditEntry[])).toEqual(["reveal"]);
    expect((auditStatus() as { waiting: number }).waiting).toBe(1);
    markAuditSynced(entries[0]!.id);
    expect(auditOutbox()).toEqual([]);
    expect(auditStatus()).toEqual({ waiting: 0, syncedAt: "2026-01-02T00:00:00.000Z" });
  });

  it("keeps only a handful of events while waiting for the log to be configured", () => {
    for (let i = 0; i < 250; i += 1) audit({ kind: "vault", action: `a${i}` });
    const dir = tmp();
    configureAudit({ dataDir: dir, now: () => 0 });
    expect(readAudit()).toHaveLength(200);
  });
});
