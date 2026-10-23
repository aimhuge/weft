import { describe, expect, it } from "vitest";
import type { ChangelogEntry } from "./changelog";
import { groupEntries, groupTitle, stateLine } from "./changelog-view";

const e = (id: string, at: number, extra: Partial<ChangelogEntry> = {}): ChangelogEntry => ({ id, project: "/r", kind: "added", text: id, at, ...extra });

describe("changelog view", () => {
  it("puts Unreleased first, then versions newest first, entries newest first", () => {
    const groups = groupEntries([
      e("a", 1, { version: "1.0.0", releasedAt: 10 }),
      e("b", 2, { version: "1.1.0", releasedAt: 20 }),
      e("c", 3, { version: "1.0.0", releasedAt: 10 }),
      e("d", 4),
      e("f", 5, { version: "0.9.0" }),
    ]);
    expect(groups.map((g) => [g.version, g.entries.map((x) => x.id)])).toEqual([
      [null, ["d"]],
      ["1.1.0", ["b"]],
      ["1.0.0", ["c", "a"]],
      ["0.9.0", ["f"]],
    ]);
    expect(groupEntries([e("x", 1, { version: "1.0.0" })])[0]?.version).toBe("1.0.0");
  });

  it("says where an entry stands", () => {
    expect(stateLine(e("a", 1))).toBe("draft");
    expect(stateLine(e("a", 1, { sha: "abcdef12345" }))).toBe("committed abcdef1");
    expect(stateLine(e("a", 1, { sha: "abcdef12345", version: "1.0.0" }))).toBe("abcdef1 · 1.0.0");
    expect(stateLine(e("a", 1, { version: "1.0.0" }))).toBe("1.0.0");
  });

  it("titles groups", () => {
    expect(groupTitle({ version: null, entries: [] })).toBe("Unreleased");
    expect(groupTitle({ version: "1.0.0", releasedAt: Date.UTC(2026, 9, 23), entries: [] })).toBe("1.0.0 · 2026-10-23");
    expect(groupTitle({ version: "1.0.0", entries: [] })).toBe("1.0.0");
  });
});
