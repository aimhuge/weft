import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangelogEntry } from "./changelog";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-changelog-"));
vi.mock("./store", () => ({ DATA_DIR: dir }));

const {
  changelogFile, addEntry, textsFor, appendEvent, editEntry, entriesFor, fold, onChangelogEvent, readChangelog, readEvents, releaseProject,
  removeEntry, stampCard, statusOf,
} = await import("./changelog");

beforeEach(() => fs.rmSync(changelogFile(), { force: true }));

const add = (over: Partial<Parameters<typeof addEntry>[0]> = {}) =>
  addEntry({ project: "/repo", kind: "added", text: "A thing", cardId: "c1", cardTitle: "Card one", ...over });

describe("changelog store", () => {
  it("lives in the data folder", () => {
    expect(changelogFile()).toBe(path.join(dir, "changelog.jsonl"));
  });

  it("adds entries that name their card, trimmed, and reads them back per project", () => {
    const a = add({ text: "  Login  " });
    add({ project: "/other" });
    expect(a).toMatchObject({ project: "/repo", kind: "added", text: "Login", cardId: "c1", cardTitle: "Card one" });
    expect(entriesFor("/repo").map((e) => e.id)).toEqual([a.id]);
    expect(readChangelog()).toHaveLength(2);
    expect(statusOf(a)).toBe("draft");
  });

  it("leaves card fields off an entry without a card", () => {
    const e = addEntry({ project: "/repo", kind: "fixed", text: "x", at: 5 });
    expect(e).toEqual({ id: e.id, project: "/repo", kind: "fixed", text: "x", at: 5 });
  });

  it("refuses empty text and unknown kinds", () => {
    expect(() => add({ text: "  " })).toThrow(/needs text/);
    expect(() => add({ kind: "nope" as never })).toThrow(/kind must be/);
  });

  it("edits and removes unreleased entries", () => {
    const a = add();
    expect(editEntry(a.id, { text: " Better ", kind: "fixed" })).toMatchObject({ text: "Better", kind: "fixed" });
    expect(editEntry(a.id, { text: "  " })).toMatchObject({ text: "Better" });
    expect(readChangelog()[0]).toMatchObject({ text: "Better", kind: "fixed" });
    expect(() => editEntry(a.id, { kind: "bad" as never })).toThrow(/kind must be/);
    removeEntry(a.id);
    expect(readChangelog()).toEqual([]);
    expect(() => editEntry(a.id, { text: "x" })).toThrow(/No changelog entry/);
    expect(() => removeEntry(a.id)).toThrow(/No changelog entry/);
  });

  it("stamps a card's uncommitted entries in that project once", () => {
    const a = add();
    const b = add({ cardId: "c2" });
    const c = add({ project: "/other" });
    expect(stampCard("c1", "/repo", "abc123")).toBe(1);
    expect(stampCard("c1", "/repo", "def456")).toBe(0);
    const [ea, eb, ec] = [a, b, c].map((x) => readChangelog().find((e) => e.id === x.id)!) as [ChangelogEntry, ChangelogEntry, ChangelogEntry];
    expect(ea).toMatchObject({ sha: "abc123" });
    expect(statusOf(ea)).toBe("committed");
    expect(eb.sha).toBeUndefined();
    expect(ec.sha).toBeUndefined();
  });

  it("stamps only the drafts a commit's files carry, and keeps the entry's files", () => {
    const scoped = add({ files: ["./lib/preview.ts", ""] });
    const loose = add({ text: "no paths" });
    expect(readChangelog().find((e) => e.id === scoped.id)?.files).toEqual(["lib/preview.ts"]);
    expect(loose.files).toBeUndefined();
    // Another card's commit in the shared tree: only the entry with no files known takes it.
    expect(stampCard("c1", "/repo", "quota", ["lib/quota.ts"])).toBe(1);
    expect(readChangelog().find((e) => e.id === scoped.id)?.sha).toBeUndefined();
    expect(stampCard("c1", "/repo", "own", ["lib/preview.ts"])).toBe(1);
    expect(readChangelog().find((e) => e.id === scoped.id)?.sha).toBe("own");
  });

  it("re-stamps and re-files an unreleased entry through an edit", () => {
    const a = add({ files: ["a.ts"] });
    stampCard("c1", "/repo", "wrong");
    const fixed = editEntry(a.id, { sha: "right", files: ["b.ts", "b.ts"] });
    expect(fixed).toMatchObject({ sha: "right", files: ["b.ts"], text: "A thing" });
    expect(fixed.committedAt).toBeGreaterThan(0);
    expect(readChangelog().find((e) => e.id === a.id)).toMatchObject({ sha: "right", files: ["b.ts"], committedAt: fixed.committedAt });
    // Emptied files: back to reading the text, and the sha stays.
    expect(editEntry(a.id, { files: [] })).toMatchObject({ sha: "right", files: [] });
    expect(readChangelog().find((e) => e.id === a.id)?.committedAt).toBe(fixed.committedAt);
  });

  it("releases every unreleased entry of a project, drafts included, and freezes them", () => {
    const a = add();
    stampCard("c1", "/repo", "abc");
    const b = add({ cardId: "c2" });
    add({ project: "/other" });
    const out = releaseProject("/repo", "1.0.0");
    expect(out.map((e) => e.id)).toEqual([a.id, b.id]);
    expect(entriesFor("/repo").every((e) => e.version === "1.0.0" && statusOf(e) === "released")).toBe(true);
    expect(releaseProject("/repo", "1.0.1")).toEqual([]);
    expect(() => editEntry(a.id, { text: "x" })).toThrow(/shipped in 1.0.0/);
    expect(() => removeEntry(a.id)).toThrow(/stays in the history/);
    expect(stampCard("c2", "/repo", "late")).toBe(0);
  });

  it("skips torn lines and ignores events for unknown entries", () => {
    fs.writeFileSync(changelogFile(), '{"t":"edit","id":"x","at":1,"text":"y"}\n{not json\n\n');
    expect(readEvents()).toHaveLength(1);
    expect(readChangelog()).toEqual([]);
    expect(readEvents(path.join(dir, "missing.jsonl"))).toEqual([]);
  });

  it("never lets a later stamp or release overwrite an earlier one", () => {
    const entry = { id: "e", project: "/r", kind: "added" as const, text: "t", at: 1 };
    const folded = fold([
      { t: "add", ...entry },
      { t: "stamp", ids: ["e", "gone"], sha: "a", at: 2 },
      { t: "stamp", ids: ["e"], sha: "b", at: 3 },
      { t: "release", ids: ["e", "gone"], version: "1", at: 4 },
      { t: "release", ids: ["e"], version: "2", at: 5 },
      { t: "edit", id: "e", at: 6 },
    ]);
    expect(folded).toEqual([{ ...entry, sha: "a", committedAt: 2, version: "1", releasedAt: 4 }]);
  });

  it("tells listeners about each event and survives one that throws", () => {
    const seen: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const offBad = onChangelogEvent(() => {
      throw new Error("boom");
    });
    const off = onChangelogEvent((e) => seen.push(e.t));
    add();
    appendEvent({ t: "remove", id: "nothing", at: 1 });
    off();
    offBad();
    add();
    expect(seen).toEqual(["add", "remove"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it("releases only committed entries when asked, leaving drafts for the next version", () => {
    const a = add();
    stampCard("c1", "/repo", "abc");
    const b = add({ cardId: "c2" });
    expect(releaseProject("/repo", "1.0.0", undefined, { committedOnly: true }).map((e) => e.id)).toEqual([a.id]);
    expect(readChangelog().find((e) => e.id === b.id)?.version).toBeUndefined();
  });

  it("remembers every text a project's entries ever had, removed ones too", () => {
    const a = add({ text: "first" });
    editEntry(a.id, { text: "second" });
    editEntry(a.id, { kind: "fixed" });
    removeEntry(add({ text: "gone" }).id);
    add({ project: "/other", text: "elsewhere" });
    appendEvent({ t: "edit", id: "unknown", at: 1, text: "stray" });
    expect([...textsFor("/repo")]).toEqual(["first", "second", "gone"]);
  });
});
