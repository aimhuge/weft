import { describe, expect, it } from "vitest";
import { progressPaths } from "./goose-progress-paths";

// The paths a Goose progress note mentions, read out of the note's text.

describe("progressPaths", () => {
  it("reads the path out of Goose's own write message", () => {
    expect(progressPaths("Wrote src/foo.ts (42 lines)")).toEqual(["src/foo.ts"]);
  });

  it("reads the path out of Goose's create message", () => {
    expect(progressPaths("Created src/foo.ts (3 lines)")).toEqual(["src/foo.ts"]);
  });

  it("reads the path out of Goose's edit message", () => {
    expect(progressPaths("Edited src/foo.ts (10 lines -> 12 lines)")).toEqual(["src/foo.ts"]);
  });

  it("reads the path out of a failure message", () => {
    expect(progressPaths("Failed to write src/foo.ts: no such file")).toEqual(["src/foo.ts"]);
  });

  it("reads the path out of an older verb's message", () => {
    expect(progressPaths("Editing src/foo.ts")).toEqual(["src/foo.ts"]);
  });

  it("reads an absolute path", () => {
    expect(progressPaths("Edited /Users/me/project/src/foo.ts (1 lines -> 2 lines)")).toEqual(["/Users/me/project/src/foo.ts"]);
  });

  it("reads a path in a subfolder", () => {
    expect(progressPaths("Wrote lib/goose-runner.ts (10 lines)")).toEqual(["lib/goose-runner.ts"]);
  });

  it("reads a path with a dot in every part of it", () => {
    expect(progressPaths("Wrote .config/app.settings.json (1 lines)")).toEqual([".config/app.settings.json"]);
  });

  it("reads a file name with a dash and an underscore in it", () => {
    expect(progressPaths("Wrote my-file_name.ts (1 lines)")).toEqual(["my-file_name.ts"]);
  });

  it("reads a quoted path", () => {
    expect(progressPaths("Wrote \"src/foo.ts\" (1 lines)")).toEqual(["src/foo.ts"]);
  });

  it("reads a path at the end of the note, with nothing after it", () => {
    expect(progressPaths("Writing src/foo.ts")).toEqual(["src/foo.ts"]);
  });

  it("reads a path at the start of the note", () => {
    expect(progressPaths("src/foo.ts was written")).toEqual(["src/foo.ts"]);
  });

  it("reads every path the note mentions, in order", () => {
    expect(progressPaths("Wrote a.ts (1 lines), then Edited b/c.ts (2 lines -> 3 lines)")).toEqual(["a.ts", "b/c.ts"]);
  });

  it("reads a path that a note mentions twice only once", () => {
    expect(progressPaths("Wrote a.ts (1 lines) and Edited a.ts (2 lines -> 3 lines)")).toEqual(["a.ts"]);
  });

  it("finds no path in a note that mentions none", () => {
    expect(progressPaths("Running the tests")).toEqual([]);
    expect(progressPaths("")).toEqual([]);
    expect(progressPaths("   ")).toEqual([]);
  });

  it("finds no path in a note of bare words", () => {
    expect(progressPaths("Thinking about the codebase")).toEqual([]);
  });

  it("does not read a flag as a path", () => {
    expect(progressPaths("Running with --verbose")).toEqual([]);
    expect(progressPaths("Running with -f")).toEqual([]);
  });

  it("does not read a flag with a dot in it as a path", () => {
    expect(progressPaths("Running with --config.json")).toEqual([]);
  });

  it("does not read a URL as a path", () => {
    expect(progressPaths("Fetching https://example.com/docs/readme.md")).toEqual([]);
    expect(progressPaths("Fetching http://example.com/a/b.ts")).toEqual([]);
  });

  it("does not read a scheme's own word as a path", () => {
    expect(progressPaths("Using file: to read")).toEqual([]);
  });

  it("does not read a line number after a path as part of the path", () => {
    expect(progressPaths("Wrote src/foo.ts:42")).toEqual(["src/foo.ts"]);
  });

  it("does not split a path that sits inside a word", () => {
    expect(progressPaths("Wrote mysrc/foo.ts")).toEqual(["mysrc/foo.ts"]);
  });

  it("does not read a home-relative path's tilde as a path of its own", () => {
    expect(progressPaths("Wrote ~/notes.md (1 lines)")).toEqual(["~/notes.md"]);
  });

  it("does not read a bare tilde as a path", () => {
    expect(progressPaths("Writing ~")).toEqual([]);
  });

  it("does not read a tilde with a slash as a path of its own", () => {
    expect(progressPaths("Writing ~/")).toEqual([]);
  });

  it("does not read a directory name without an extension as a path", () => {
    expect(progressPaths("Entering src")).toEqual([]);
  });

  it("reads a path that carries an extension but no separator", () => {
    expect(progressPaths("Wrote README.md (1 lines)")).toEqual(["README.md"]);
  });

  it("does not read a trailing period as part of the path", () => {
    expect(progressPaths("Wrote src/foo.ts.")).toEqual(["src/foo.ts"]);
  });
});
