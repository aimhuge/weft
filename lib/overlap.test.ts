import { describe, expect, it } from "vitest";
import { alsoHereLine, busyHere, busyInFolder, editedPath, filesLine, isBusy, sameTree, sharedFiles, touchFile, TOUCHED_CAP } from "./overlap";
import type { Card } from "./types";

let seq = 0;
function card(overrides: Partial<Card> = {}): Card {
  seq += 1;
  return {
    id: `c${seq}`,
    title: `Card ${seq}`,
    prompt: "do it",
    cwd: "/repo",
    backend: "claude",
    permissionMode: "default",
    column: "running",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("sameTree", () => {
  it("matches the same folder, ignoring trailing slashes", () => {
    expect(sameTree("/me/app", "/me/app/")).toBe(true);
  });

  it("matches a folder inside the other, either way round", () => {
    expect(sameTree("/me/app/src", "/me/app")).toBe(true);
    expect(sameTree("/me/app", "/me/app/src")).toBe(true);
  });

  it("does not match siblings or a shared name prefix", () => {
    expect(sameTree("/me/app", "/me/other")).toBe(false);
    expect(sameTree("/me/app", "/me/app-two")).toBe(false);
  });

  it("keeps a Claude Code worktree apart from its repo and from other worktrees", () => {
    expect(sameTree("/me/app/.claude/worktrees/x", "/me/app")).toBe(false);
    expect(sameTree("/me/app/.claude/worktrees/x", "/me/app/.claude/worktrees/y")).toBe(false);
    expect(sameTree("/me/app/.claude/worktrees/x/src", "/me/app/.claude/worktrees/x")).toBe(true);
  });
});

describe("isBusy", () => {
  it("counts running and needs-you cards, not archived ones or the copilot", () => {
    expect(isBusy(card({ column: "running" }))).toBe(true);
    expect(isBusy(card({ column: "needs_you" }))).toBe(true);
    expect(isBusy(card({ column: "review" }))).toBe(false);
    expect(isBusy(card({ column: "backlog" }))).toBe(false);
    expect(isBusy(card({ column: "running", archived: true }))).toBe(false);
    expect(isBusy(card({ column: "running", role: "copilot" }))).toBe(false);
  });
});

describe("busyHere", () => {
  it("lists the other busy cards in the card's folder", () => {
    const me = card({ cwd: "/repo", column: "review" });
    const sub = card({ cwd: "/repo/web" });
    const waiting = card({ cwd: "/repo/", column: "needs_you" });
    const idle = card({ cwd: "/repo", column: "done" });
    const elsewhere = card({ cwd: "/other" });
    expect(busyHere([me, sub, waiting, idle, elsewhere], me)).toEqual([sub, waiting]);
  });

  it("leaves the card itself out", () => {
    const me = card();
    expect(busyHere([me], me)).toEqual([]);
  });

  it("puts an isolated card in its worktree, not the shared tree", () => {
    const wt = { path: "/wt/repo-1/a", branch: "weft/a", base: "x", repo: "/repo" };
    const me = card({ cwd: "/repo" });
    const isolated = card({ cwd: "/repo", isolated: true, worktree: wt });
    expect(busyHere([me, isolated], me)).toEqual([]);
    expect(busyInFolder([me, isolated], "/wt/repo-1/a/src")).toEqual([isolated]);
    expect(busyHere([me, isolated], card({ cwd: "/repo", worktree: wt }))).toEqual([isolated]);
  });

  it("checks a folder before any card exists", () => {
    const busy = card({ cwd: "/repo" });
    expect(busyInFolder([busy], "/repo/src")).toEqual([busy]);
  });
});

describe("alsoHereLine", () => {
  it("names the first card and counts the rest", () => {
    expect(alsoHereLine([])).toBe("");
    expect(alsoHereLine([card({ title: "Fix login" })])).toBe("Also running here: Fix login");
    expect(alsoHereLine([card({ title: "Fix login" }), card(), card()])).toBe("Also running here: Fix login and 2 more");
  });

  it("says which files busy cards both edited, naming a card that did first", () => {
    const me = card({ touchedFiles: ["/repo/lib/a.ts", "/repo/b.ts", "/repo/c.ts", "/repo/d.ts"] });
    const quiet = card({ title: "Docs", touchedFiles: ["/repo/README.md"] });
    const clash = card({ title: "Fix login", touchedFiles: ["/repo/b.ts", "/repo/lib/a.ts"] });
    expect(alsoHereLine(busyHere([me, quiet, clash], me))).toBe("Also running here: Fix login and 1 more — both edited a.ts and b.ts");
    const wide = card({ touchedFiles: ["/repo/c.ts", "/repo/d.ts"] });
    expect(alsoHereLine(busyHere([me, clash, wide], me))).toBe("Also running here: Fix login and 1 more — both edited a.ts, b.ts and 2 more");
    expect(alsoHereLine(busyHere([me, quiet], me))).toBe("Also running here: Docs");
  });
});

describe("sharedFiles", () => {
  it("lists the card's files any other card edited, in the card's order", () => {
    const me = card({ touchedFiles: ["/r/a", "/r/b", "/r/c"] });
    expect(sharedFiles(me, [card({ touchedFiles: ["/r/c"] }), card({ touchedFiles: ["/r/a", "/r/x"] })])).toEqual(["/r/a", "/r/c"]);
    expect(sharedFiles(card(), [me])).toEqual([]);
  });
});

describe("editedPath", () => {
  it("reads the path from file-editing tools only", () => {
    expect(editedPath("Edit", { file_path: "/r/a.ts" })).toBe("/r/a.ts");
    expect(editedPath("Write", { file_path: "/r/a.ts" })).toBe("/r/a.ts");
    expect(editedPath("MultiEdit", { file_path: "/r/a.ts" })).toBe("/r/a.ts");
    expect(editedPath("NotebookEdit", { notebook_path: "/r/n.ipynb" })).toBe("/r/n.ipynb");
    expect(editedPath("Read", { file_path: "/r/a.ts" })).toBeUndefined();
    expect(editedPath("Edit", {})).toBeUndefined();
  });
});

describe("touchFile", () => {
  it("moves the file to the front, and returns undefined when it's already there", () => {
    expect(touchFile(undefined, "/a")).toEqual(["/a"]);
    expect(touchFile(["/b", "/a"], "/a")).toEqual(["/a", "/b"]);
    expect(touchFile(["/a", "/b"], "/a")).toBeUndefined();
  });

  it("keeps at most TOUCHED_CAP files", () => {
    const full = Array.from({ length: TOUCHED_CAP }, (_, i) => `/f${i}`);
    const next = touchFile(full, "/new")!;
    expect(next).toHaveLength(TOUCHED_CAP);
    expect(next[0]).toBe("/new");
    expect(next).not.toContain(`/f${TOUCHED_CAP - 1}`);
  });
});

describe("sameTree at the filesystem root", () => {
  it("counts a card working in / as sharing a tree with every folder", () => {
    expect(sameTree("/", "/me/app")).toBe(true);
    expect(sameTree("/me/app", "/")).toBe(true);
  });
});

describe("filesLine", () => {
  it("names files by their base name, falling back to the whole path when it ends in a slash", () => {
    expect(filesLine(["/r/lib/a.ts"])).toBe("a.ts");
    expect(filesLine(["build/"])).toBe("build/");
    expect(filesLine([])).toBe("");
  });
});
