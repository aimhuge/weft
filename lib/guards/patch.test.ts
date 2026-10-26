import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePatch, patchCalls } from "./patch";

// Codex's apply_patch format (lib/guards/patch.ts), read as the calls Claude Code would have made: a Write for a
// file it adds, moves to or deletes, and a MultiEdit of the hunks for a file it updates.

const CWD = "/w";
const at = (file: string) => path.resolve(CWD, file);

describe("parsePatch", () => {
  it("reads the files a patch names, in order", () => {
    const files = parsePatch("*** Begin Patch\n*** Add File: a.ts\n+x\n*** Update File: b.ts\n@@\n-o\n+n\n*** Delete File: c.ts\n*** End Patch");
    expect(files.map((f) => [f.kind, f.file])).toEqual([
      ["add", "a.ts"],
      ["update", "b.ts"],
      ["delete", "c.ts"],
    ]);
  });

  it("keeps the added lines of a new file", () => {
    expect(parsePatch("*** Begin Patch\n*** Add File: a.ts\n+one\n+two\n*** End Patch")).toEqual([
      { kind: "add", file: "a.ts", added: ["one", "two"], edits: [] },
    ]);
  });

  it("splits an update's hunks into edits", () => {
    const [file] = parsePatch("*** Begin Patch\n*** Update File: a.ts\n@@ ctx\n keep\n-old\n+new\n@@ ctx2\n keep2\n-old2\n+new2\n*** End Patch");
    expect(file?.edits).toEqual([
      { old_string: "keep\nold", new_string: "keep\nnew" },
      { old_string: "keep2\nold2", new_string: "keep2\nnew2" },
    ]);
  });

  it("notes where an update moves its file to", () => {
    const [file] = parsePatch("*** Begin Patch\n*** Update File: a.ts\n*** Move to: b.ts\n@@\n-old\n+new\n*** End Patch");
    expect(file?.moveTo).toBe("b.ts");
  });

  it("skips the Begin and End Patch lines and anything before the first file", () => {
    const files = parsePatch("prologue\n*** Begin Patch\n*** Add File: a.ts\n+x\n*** End Patch\nepilogue");
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ kind: "add", file: "a.ts", added: ["x"] });
  });

  it("reads a patch that ends its lines with carriage returns", () => {
    const [file] = parsePatch("*** Begin Patch\r\n*** Add File: a.ts\r\n+x\r\n*** End Patch");
    expect(file?.added).toEqual(["x"]);
  });

  it("leaves an update with nothing in it without an edit", () => {
    const [file] = parsePatch("*** Begin Patch\n*** Update File: a.ts\n@@\n*** End Patch");
    expect(file?.edits).toEqual([]);
  });
});

describe("patchCalls", () => {
  it("turns an added file into a Write with its content and an absolute path", () => {
    expect(patchCalls("*** Begin Patch\n*** Add File: /tmp/w/b.txt\n+x\n*** End Patch", CWD)).toEqual([
      { tool: "Write", input: { file_path: "/tmp/w/b.txt", content: "x" } },
    ]);
  });

  it("resolves a relative path against the call's folder", () => {
    expect(patchCalls("*** Begin Patch\n*** Add File: b.txt\n+x\n*** End Patch", CWD)).toEqual([
      { tool: "Write", input: { file_path: at("b.txt"), content: "x" } },
    ]);
    expect(patchCalls("*** Begin Patch\n*** Add File: sub/b.txt\n+x\n*** End Patch", CWD)[0]?.input.file_path).toBe(at("sub/b.txt"));
  });

  it("turns an update with two hunks into one MultiEdit of two edits", () => {
    const calls = patchCalls("*** Begin Patch\n*** Update File: a.ts\n@@ ctx\n keep\n-old\n+new\n@@ ctx2\n keep2\n-old2\n+new2\n*** End Patch", CWD);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.tool).toBe("MultiEdit");
    expect(calls[0]?.input).toEqual({
      file_path: at("a.ts"),
      edits: [
        { old_string: "keep\nold", new_string: "keep\nnew" },
        { old_string: "keep2\nold2", new_string: "keep2\nnew2" },
      ],
    });
  });

  it("keeps a context line in both the old and the new text", () => {
    const [call] = patchCalls("*** Begin Patch\n*** Update File: a.ts\n@@\n keep\n*** End Patch", CWD);
    expect(call?.input.edits).toEqual([{ old_string: "keep", new_string: "keep" }]);
  });

  it("keeps an empty context line in both the old and the new text", () => {
    const [call] = patchCalls("*** Begin Patch\n*** Update File: a.ts\n@@\n keep\n\n+new\n*** End Patch", CWD);
    expect(call?.input.edits).toEqual([{ old_string: "keep\n", new_string: "keep\n\nnew" }]);
  });

  it("writes the file to its new name when an update moves it", () => {
    const calls = patchCalls("*** Begin Patch\n*** Update File: a.ts\n*** Move to: b.ts\n@@\n-old\n+new\n*** End Patch", CWD);
    expect(calls).toEqual([
      { tool: "MultiEdit", input: { file_path: at("a.ts"), edits: [{ old_string: "old", new_string: "new" }] } },
      { tool: "Write", input: { file_path: at("b.ts"), content: "new" } },
    ]);
  });

  it("turns a deleted file into a Write of nothing", () => {
    expect(patchCalls("*** Begin Patch\n*** Delete File: a.ts\n*** End Patch", CWD)).toEqual([
      { tool: "Write", input: { file_path: at("a.ts"), content: "" } },
    ]);
  });

  it("keeps the order of the files in one patch", () => {
    const calls = patchCalls("*** Begin Patch\n*** Add File: a.ts\n+1\n*** Update File: b.ts\n@@\n-o\n+n\n*** Delete File: c.ts\n*** End Patch", CWD);
    expect(calls.map((c) => [c.tool, c.input.file_path])).toEqual([
      ["Write", at("a.ts")],
      ["MultiEdit", at("b.ts")],
      ["Write", at("c.ts")],
    ]);
  });

  it("skips a hunk line that is neither context nor a change, like git's no-newline marker", () => {
    const [call] = patchCalls("*** Begin Patch\n*** Update File: a.ts\n@@\n-a\n+b\n\\ No newline at end of file\n*** End Patch", CWD);
    expect(call?.input).toMatchObject({ edits: [{ old_string: "a", new_string: "b" }] });
  });

  it("makes no call for a patch that names no file", () => {
    expect(patchCalls("*** Begin Patch\n*** End Patch", CWD)).toEqual([]);
    expect(patchCalls("", CWD)).toEqual([]);
  });
});
