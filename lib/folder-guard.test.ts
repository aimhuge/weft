import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The folder gate (lib/folder-guard.ts) on real temp folders, with the board's card and the settings mocked.

const h = vi.hoisted(() => ({ card: undefined as { id: string; role?: string; readScope?: string[] } | undefined, allowed: [] as string[] }));
vi.mock("./store", () => ({ DATA_DIR: "/nonexistent/.weft", getCard: (id: string) => (id === h.card?.id ? h.card : undefined) }));
vi.mock("./settings", () => ({ allowedFolders: () => h.allowed }));

const { folderAsk, folderGuard, folderGuardMatcher, grantedRead, outsideFolder, pathsOf, tilde } = await import("./folder-guard");

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-folder-guard-")));
const project = path.join(root, "project");
const other = path.join(root, "other");
fs.mkdirSync(path.join(project, "src"), { recursive: true });
fs.mkdirSync(path.join(other, "lib"), { recursive: true });
fs.writeFileSync(path.join(other, "package.json"), "{}");
fs.writeFileSync(path.join(other, "lib", "a.ts"), "x");

// outsideFolder takes the ground it works on: a home of its own, and the free roots (Weft's own places, system paths).
const home = path.join(root, "home");
fs.mkdirSync(home);
const at = { home, free: [path.join(home, ".claude"), "/usr", "/dev"] };
// The hook uses the real ground, whose home is the test sandbox's; /Users/<name> is outside it.
const away = "/Users/zzz-guard-test";

beforeEach(() => {
  h.card = { id: "c1" };
  h.allowed = [];
});

describe("pathsOf", () => {
  it("reads each file tool's path argument", () => {
    expect(pathsOf("Read", { file_path: "/a/b.ts" })).toEqual(["/a/b.ts"]);
    expect(pathsOf("Edit", { file_path: "/a/b.ts" })).toEqual(["/a/b.ts"]);
    expect(pathsOf("NotebookEdit", { notebook_path: "/a/n.ipynb" })).toEqual(["/a/n.ipynb"]);
    expect(pathsOf("Grep", { pattern: "x", path: "/a" })).toEqual(["/a"]);
    expect(pathsOf("LS", { path: "/a" })).toEqual(["/a"]);
    expect(pathsOf("Grep", { pattern: "x" })).toEqual([]);
  });

  it("takes a Glob's path and an absolute pattern whole", () => {
    expect(pathsOf("Glob", { pattern: "**/*.ts", path: "/a" })).toEqual(["/a"]);
    expect(pathsOf("Glob", { pattern: "/a/b/**/*.ts" })).toEqual(["/a/b/**/*.ts"]);
    expect(pathsOf("Glob", { pattern: "~/Downloads/*.mp3" })).toEqual(["~/Downloads/*.mp3"]);
    expect(pathsOf("Glob", { pattern: "src/*.ts" })).toEqual([]);
  });

  it("finds absolute, home and parent paths in a Bash command, not URLs or sed expressions", () => {
    expect(pathsOf("Bash", { command: "ls ~/Downloads && cat /Users/me/x.txt > /dev/null" })).toEqual(["~/Downloads", "/Users/me/x.txt", "/dev/null"]);
    expect(pathsOf("Bash", { command: 'cp "$HOME/a b" ../x; ls ~' })).toEqual(["$HOME/a b", "../x", "~"]);
    expect(pathsOf("Bash", { command: "curl https://example.com/a/b | sed 's/a/b/'" })).toEqual([]);
    expect(pathsOf("Bash", {})).toEqual([]);
  });

  it("keeps the spaces in a quoted or backslash-escaped Bash path", () => {
    expect(pathsOf("Bash", { command: 'cd "/Users/p/My Drive/app" && cat x' })).toEqual(["/Users/p/My Drive/app"]);
    expect(pathsOf("Bash", { command: "ls '~/My Drive/a b'" })).toEqual(["~/My Drive/a b"]);
    expect(pathsOf("Bash", { command: String.raw`ls ~/My\ Drive/app /tmp` })).toEqual(["~/My Drive/app", "/tmp"]);
    expect(pathsOf("Bash", { command: 'echo "/a" "/b c"' })).toEqual(["/a", "/b c"]);
  });
});

describe("a project folder with a space in its name", () => {
  // Google Drive projects live in ~/My Drive: every command cd'd there used to ask about ~/My.
  const drive = path.join(home, "My Drive", "app");
  fs.mkdirSync(drive, { recursive: true });
  fs.mkdirSync(path.join(home, "My Drive", "other-app"));

  it("lets a quoted or escaped cd into the project through", () => {
    expect(outsideFolder("Bash", { command: `cd "${drive}" && cat package.json` }, drive, [], at)).toBeUndefined();
    expect(outsideFolder("Bash", { command: `cd '${drive}/lib'` }, drive, [], at)).toBeUndefined();
    expect(outsideFolder("Bash", { command: `ls ${drive.replace(/ /g, "\\ ")}` }, drive, [], at)).toBeUndefined();
  });

  it("still asks about a sibling folder", () => {
    expect(outsideFolder("Bash", { command: `cd "${drive}" && cd ../other-app` }, drive, [], at)).toMatchObject({ verb: "use", directory: path.join(home, "My Drive", "other-app") });
  });
});

describe("a glob in a path", () => {
  // ~/dev/*weft*/node_modules from the weft project used to offer the literal folder ~/dev/*weft*, which granted nothing.
  const dev = path.join(home, "dev");
  const weft = path.join(dev, "weft");
  const build = path.join(dev, "weft-build");
  for (const d of [weft, build]) fs.mkdirSync(path.join(d, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(build, "package.json"), "{}");
  const cmd = { command: "ls ~/dev/*weft*/node_modules" };

  it("asks only about the real folder a match lies in, naming it", () => {
    expect(outsideFolder("Bash", cmd, weft, [], at)).toEqual({ directory: build, token: "~/dev/*weft*/node_modules", verb: "use" });
  });

  it("lets it through once that folder is granted, or when every match is in the project", () => {
    expect(outsideFolder("Bash", cmd, weft, [build], at)).toBeUndefined();
    expect(outsideFolder("Bash", { command: "ls ~/dev/w?ft/node_modules ~/dev/weft/{node_modules,x}" }, weft, [], at)).toBeUndefined();
  });

  it("falls back to its fixed start when nothing matches", () => {
    expect(outsideFolder("Bash", { command: "ls ~/dev/nothing-*/x" }, weft, [], at)?.directory).toBe(dev);
    expect(outsideFolder("Glob", { pattern: path.join(home, "dev", "zz*", "*.ts") }, weft, [], at)).toMatchObject({ directory: dev, verb: "read" });
  });

  it("checks a Glob pattern's matches, and a glob that fails to walk as its fixed start", () => {
    expect(outsideFolder("Glob", { pattern: path.join(dev, "weft*", "node_modules") }, weft, [], at)?.directory).toBe(build);
    expect(outsideFolder("Glob", { pattern: path.join(weft, "**") }, weft, [], at)).toBeUndefined();
    const spy = vi.spyOn(fs, "globSync").mockImplementationOnce(() => {
      throw new Error("bad pattern");
    });
    expect(outsideFolder("Bash", cmd, weft, [], at)?.directory).toBe(dev);
    spy.mockRestore();
  });

  it("lets a granted read through only when every match is granted", () => {
    h.card = { id: "c1", readScope: [build] };
    expect(grantedRead("Glob", { pattern: path.join(dev, "weft-b*", "*") }, weft, "c1")).toBe(true);
    expect(grantedRead("Glob", { pattern: path.join(dev, "*", "*") }, project, "c1")).toBe(false);
  });
});

describe("outsideFolder", () => {
  it("lets the project, a granted folder and Weft's own places through", () => {
    expect(outsideFolder("Read", { file_path: path.join(project, "src", "a.ts") }, project, [], at)).toBeUndefined();
    expect(outsideFolder("Read", { file_path: "src/a.ts" }, project, [], at)).toBeUndefined();
    expect(outsideFolder("Read", { file_path: path.join(home, ".claude", "settings.json") }, project, [], at)).toBeUndefined();
    expect(outsideFolder("Bash", { command: "cat /usr/bin/env /dev/null" }, project, [], at)).toBeUndefined();
  });

  it("fences other cards' worktrees off inside a free folder, but not the card's own", () => {
    const data = path.join(home, ".weft");
    const fenced = { ...at, free: [...at.free, data], fenced: [path.join(data, "worktrees")] };
    const mine = path.join(data, "worktrees", "repo-1", "a");
    const theirs = path.join(data, "worktrees", "repo-1", "b");
    fs.mkdirSync(mine, { recursive: true });
    fs.mkdirSync(theirs, { recursive: true });
    expect(outsideFolder("Read", { file_path: path.join(data, "pages", "x.html") }, mine, [], fenced)).toBeUndefined();
    expect(outsideFolder("Edit", { file_path: path.join(mine, "a.ts") }, mine, [], fenced)).toBeUndefined();
    expect(outsideFolder("Edit", { file_path: path.join(theirs, "a.ts") }, mine, [], fenced)).toMatchObject({ verb: "change" });
    expect(outsideFolder("Read", { file_path: path.join(theirs, "a.ts") }, mine, [theirs], fenced)).toBeUndefined();
    expect(outsideFolder("Read", { file_path: path.join(project, "src", "a.ts") }, mine, [], fenced)).toMatchObject({ verb: "read" });
  });

  it("asks about another folder, granting its project root, and words it by tool", () => {
    const out = outsideFolder("Read", { file_path: path.join(home, "Downloads-guard-test", "a.mp3") }, project, [], at);
    expect(out).toMatchObject({ verb: "read", directory: path.join(home, "Downloads-guard-test") });
    expect(outsideFolder("Edit", { file_path: path.join(home, "zzz-guard-test", "a.ts") }, project, [], at)).toMatchObject({ verb: "change" });
    expect(outsideFolder("Bash", { command: "ls ~/zzz-guard-test" }, project, [], at)).toMatchObject({ verb: "use", directory: path.join(home, "zzz-guard-test") });
  });

  it("grants a project's root rather than the file's folder", () => {
    const fake = path.join(home, "weft-guard-test-project");
    fs.mkdirSync(path.join(fake, "lib"), { recursive: true });
    fs.writeFileSync(path.join(fake, "package.json"), "{}");
    try {
      expect(outsideFolder("Read", { file_path: path.join(fake, "lib", "a.ts") }, project, [], at)?.directory).toBe(fake);
      expect(outsideFolder("Read", { file_path: path.join(fake, "lib", "a.ts") }, project, [fake], at)).toBeUndefined();
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });

  it("ignores Bash paths outside the user's own files", () => {
    expect(outsideFolder("Bash", { command: "ls /nonexistent-root/x" }, project, [], at)).toBeUndefined();
  });

  it("follows symlinks out of the project", () => {
    const target = path.join(home, "zzz-guard-link-target");
    const link = path.join(project, "link");
    fs.mkdirSync(target, { recursive: true });
    fs.symlinkSync(target, link);
    try {
      expect(outsideFolder("Read", { file_path: path.join(link, "a.txt") }, project, [], at)?.directory).toBe(target);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
      fs.rmSync(link, { force: true });
    }
  });

  it("resolves a path that doesn't exist yet against its nearest folder", () => {
    expect(outsideFolder("Write", { file_path: path.join(project, "new", "deep", "a.ts") }, project, [], at)).toBeUndefined();
  });
});

describe("tilde", () => {
  it("shortens a home path and leaves others", () => {
    expect(tilde(path.join(home, "Downloads"), home)).toBe("~/Downloads");
    expect(tilde("/opt/x", home)).toBe("/opt/x");
  });
});

describe("folderGuard hook", () => {
  const run = (toolName: string, input: Record<string, unknown>, id = "t1", cwd = project) =>
    folderGuard(() => "c1")({ hook_event_name: "PreToolUse", tool_name: toolName, tool_input: input, cwd } as never, id, { signal: new AbortController().signal });

  it("matches the file tools and Bash", () => {
    expect(folderGuardMatcher(() => "c1").matcher).toBe("Read|Edit|MultiEdit|Write|NotebookEdit|Glob|Grep|LS|Bash");
  });

  it("asks about a folder outside the project and remembers the prompt for canUseTool", async () => {
    const result = await run("Bash", { command: `ls ${away}` });
    expect(result).toMatchObject({ hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: `Outside the project: use ${away}` } });
    expect(folderAsk("t1")).toEqual({
      question: `Outside the project: use ${away}`,
      why: { category: "outside", detail: `${away} isn't in this card's project folder` },
      folder: { directory: away, token: away },
    });
  });

  it("stays quiet inside the project, with a folder the card was granted, or one allowed for all", async () => {
    const dir = away;
    expect(await run("Read", { file_path: path.join(project, "a.ts") }, "t2")).toEqual({});
    h.card = { id: "c1", readScope: [dir] };
    expect(await run("Read", { file_path: path.join(dir, "a.ts") }, "t3")).toEqual({});
    h.card = { id: "c1" };
    h.allowed = [dir];
    expect(await run("Read", { file_path: path.join(dir, "a.ts") }, "t4")).toEqual({});
    expect(folderAsk("t4")).toBeUndefined();
  });

  it("does nothing for the copilot, an unknown card, other hook events or a call with no id", async () => {
    const outside = { file_path: path.join(away, "a.ts") };
    h.card = { id: "c1", role: "copilot" };
    expect(await run("Read", outside, "t5")).toEqual({});
    h.card = undefined;
    expect(await run("Read", outside, "t6")).toEqual({});
    h.card = { id: "c1" };
    const hook = folderGuard(() => "c1");
    expect(await hook({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: outside, cwd: project } as never, "t7", { signal: new AbortController().signal })).toEqual({});
    expect(await hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: outside, cwd: project } as never, undefined, { signal: new AbortController().signal })).toEqual({});
    expect(folderAsk(undefined)).toBeUndefined();
  });

  it("forgets the oldest prompts past its cap", async () => {
    const outside = { file_path: path.join(away, "a.ts") };
    for (let i = 0; i < 202; i++) await run("Read", outside, `cap${i}`);
    expect(folderAsk("cap0")).toBeUndefined();
    expect(folderAsk("cap201")).toBeDefined();
  });
});

describe("grantedRead", () => {
  const dir = away;

  it("allows a read-only call whose paths are all in granted folders or the project", () => {
    h.card = { id: "c1", readScope: [dir] };
    expect(grantedRead("Read", { file_path: path.join(dir, "a.ts") }, project, "c1")).toBe(true);
    expect(grantedRead("Grep", { pattern: "x", path: path.join(dir, "sub") }, project, "c1")).toBe(true);
    h.card = { id: "c1" };
    h.allowed = [dir];
    expect(grantedRead("Glob", { pattern: "*.ts", path: dir }, project, "c1")).toBe(true);
  });

  it("is false for writes, Bash, an ungranted folder, or a call with no path", () => {
    h.card = { id: "c1", readScope: [dir] };
    expect(grantedRead("Edit", { file_path: path.join(dir, "a.ts") }, project, "c1")).toBe(false);
    expect(grantedRead("Bash", { command: `cat ${dir}/a.ts` }, project, "c1")).toBe(false);
    expect(grantedRead("Read", { file_path: "/Users/zzz-guard-elsewhere/a.ts" }, project, "c1")).toBe(false);
    expect(grantedRead("Grep", { pattern: "x" }, project, "c1")).toBe(false);
    expect(grantedRead("Read", { file_path: path.join(dir, "a.ts") }, project, undefined)).toBe(false);
  });
});
