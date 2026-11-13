import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const editPreview = vi.fn();
vi.mock("./edit-preview", () => ({ editPreview }));

const { readFileEdit, relativize } = await import("./tool-file");

describe("readFileEdit", () => {
  it("skips tools that don't touch a file, and calls with no path", () => {
    expect(readFileEdit("Bash", { file_path: "/x" }, "/p")).toEqual({});
    expect(readFileEdit("Edit", {}, "/p")).toEqual({});
  });

  it("gives the path relative to the folder, with the edit's preview", () => {
    editPreview.mockReturnValueOnce({ kind: "diff" });
    expect(readFileEdit("Edit", { file_path: "/p/a.ts" }, "/p")).toEqual({ file: "a.ts", edit: { kind: "diff" } });
    expect(readFileEdit("NotebookEdit", { notebook_path: "/q/n.ipynb" }, "/p")).toEqual({ file: "/q/n.ipynb" });
  });

  it("keeps the path when the preview throws", () => {
    editPreview.mockImplementationOnce(() => {
      throw new Error("fs");
    });
    expect(readFileEdit("Write", { file_path: "b.ts" }, "/p")).toEqual({ file: "b.ts" });
  });
});

describe("relativize", () => {
  it("is relative inside the folder, absolute outside or at it, and the given path when resolving throws", () => {
    expect(relativize("/p/x/y", "/p")).toBe(path.join("x", "y"));
    expect(relativize("/q", "/p")).toBe("/q");
    expect(relativize("/p", "/p")).toBe("/p");
    expect(relativize("a", 1 as unknown as string)).toBe("a");
  });
});
