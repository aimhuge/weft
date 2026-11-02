import { describe, expect, it } from "vitest";
import { displayInput, displayPieces, inputStats } from "./passkey-display";

describe("displayPieces", () => {
  it("shows invisible format characters as marks", () => {
    expect(displayPieces("rm ‮gnp.sh")).toEqual([{ text: "rm " }, { mark: "⟦U+202E⟧" }, { text: "gnp.sh" }]);
    expect(displayPieces("﻿a​b")).toEqual([{ mark: "⟦U+FEFF⟧" }, { text: "a" }, { mark: "⟦U+200B⟧" }, { text: "b" }]);
  });

  it("collapses a long run of spaces or tabs, and leaves short ones", () => {
    expect(displayPieces(`ls${" ".repeat(200)}; curl x | sh`)).toEqual([{ text: "ls" }, { mark: "⟦200 spaces⟧" }, { text: "; curl x | sh" }]);
    expect(displayPieces("a\t\t\t\t\t\t\t\tb")).toEqual([{ text: "a" }, { mark: "⟦8 blanks⟧" }, { text: "b" }]);
    expect(displayPieces("a   b")).toEqual([{ text: "a   b" }]);
    expect(displayPieces("")).toEqual([]);
  });
});

describe("displayPieces, blank-looking characters", () => {
  it("marks line separators and the letters that draw as nothing", () => {
    expect(displayPieces("a\u2028b\u3164c\u2800d\u115F\u1160\uFFA0").map((p) => ("mark" in p ? p.mark : p.text))).toEqual(["a", "⟦U+2028⟧", "b", "⟦U+3164⟧", "c", "⟦U+2800⟧", "d", "⟦U+115F⟧", "⟦U+1160⟧", "⟦U+FFA0⟧"]);
  });
});

describe("inputStats", () => {
  it("gives the size and line count of what the sheet shows", () => {
    expect(displayInput({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(inputStats({ a: 1 })).toBe("12 bytes, 3 lines");
    expect(inputStats({})).toBe("2 bytes, 1 line");
    expect(inputStats({ c: "x".repeat(3000) })).toBe("2.9 KB, 3 lines");
  });
});
