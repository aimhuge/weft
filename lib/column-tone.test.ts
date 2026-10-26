// Each column's colour, in one place (lib/column-tone.ts).
import { describe, expect, it } from "vitest";
import { COLUMN_TONE } from "./column-tone";
import type { Column } from "./types";

const COLUMNS: Column[] = ["running", "needs_you", "review", "backlog", "done"];

describe("COLUMN_TONE", () => {
  it("gives every column a text tone, a bar tone and a dot tone", () => {
    expect(Object.keys(COLUMN_TONE).sort()).toEqual([...COLUMNS].sort());
    for (const column of COLUMNS) {
      const tone = COLUMN_TONE[column];
      expect(tone.text, column).toMatch(/^text-/);
      expect(tone.bar, column).toMatch(/^bg-/);
      expect(tone.dot, column).toMatch(/^bg-/);
    }
  });

  it("gives the bar and the dot the same colour, so a card and its band agree", () => {
    for (const column of COLUMNS) {
      const tone = COLUMN_TONE[column];
      expect(tone.bar, column).toBe(tone.dot);
      expect(tone.text, column).toBe(tone.bar.replace(/^bg-/, "text-"));
    }
  });
});
