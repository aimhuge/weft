import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toolVerdict } from "./secret-guard";
import { fromCwd, placedPath } from "./secret-guard-files";
import { inOwnProject, ownProjectDirs, withoutOwnProject } from "./secret-guard-own-project";

// A thread reads its own project's folder in the CLI's home (an oversized tool answer, its sessions' transcripts), never
// another project's, the CLI's settings or hooks, and never writes there (2026-11-04: changelog_list's 80k-char answer
// went to tool-results and the guard refused it).

const DATA = "/Users/me/.weft";
const REFUSED = "can't be read";
const SID = "0b9e1a52-1f0e-4c4a-9d55-3a1d2b3c4d5e";
const OTHER = "11111111-2222-4333-8444-555555555555";
const FRESH = "22222222-3333-4444-8555-666666666666";
let home: string;
let project: string;
let mine: string;
let theirs: string;
let result: string;

beforeAll(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-own-project-")));
  const projects = path.join(home, ".claude", "projects");
  mine = path.join(projects, "-dev-app");
  theirs = path.join(projects, "-dev-other");
  fs.mkdirSync(path.join(mine, SID, "tool-results"), { recursive: true });
  fs.writeFileSync(path.join(mine, `${SID}.jsonl`), "{}");
  fs.writeFileSync(path.join(mine, "older.jsonl"), "{}");
  result = path.join(mine, SID, "tool-results", "mcp-board-changelog_list.txt");
  fs.writeFileSync(result, "entries");
  fs.mkdirSync(theirs, { recursive: true });
  fs.writeFileSync(path.join(theirs, `${OTHER}.jsonl`), "{}");
  fs.writeFileSync(path.join(home, ".claude", "settings.json"), "{}");
  // A link out of the project, to another project's transcript.
  fs.symlinkSync(path.join(theirs, `${OTHER}.jsonl`), path.join(mine, "sneaky.jsonl"));
  project = path.join(home, "dev", "app");
  fs.mkdirSync(project, { recursive: true });
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

const verdict = (tool: string, input: unknown, session: string | undefined = SID) => fromCwd(project, () => toolVerdict(tool, input, DATA, undefined, session));

describe("ownProjectDirs", () => {
  it("finds the project folder holding the session's transcript or its folder", () => {
    expect(ownProjectDirs(SID)).toEqual([mine]);
    expect(ownProjectDirs(OTHER)).toEqual([theirs]);
  });

  it("finds nothing for no session, a non-uuid, or one the CLI hasn't written yet", () => {
    expect(ownProjectDirs(undefined)).toEqual([]);
    expect(ownProjectDirs("..")).toEqual([]);
    expect(ownProjectDirs("*")).toEqual([]);
    expect(ownProjectDirs(FRESH)).toEqual([]);
  });

  it("finds nothing when the CLI has no projects folder", () => {
    vi.mocked(os.homedir).mockReturnValueOnce(path.join(home, "nowhere"));
    expect(ownProjectDirs("33333333-3333-4444-8555-666666666666")).toEqual([]);
  });
});

describe("inOwnProject", () => {
  it("holds the project folder and anything in it", () => {
    expect(inOwnProject(mine, SID)).toBe(true);
    expect(inOwnProject(result, SID)).toBe(true);
    expect(inOwnProject(path.join(mine, "older.jsonl"), SID)).toBe(true);
    expect(inOwnProject(path.join(mine, "not-yet.txt"), SID)).toBe(true);
  });

  it("refuses another project, a `..`, a link out, or no session", () => {
    expect(inOwnProject(path.join(theirs, `${OTHER}.jsonl`), SID)).toBe(false);
    expect(inOwnProject(`${mine}/../-dev-other/${OTHER}.jsonl`, SID)).toBe(false);
    expect(inOwnProject(path.join(mine, "sneaky.jsonl"), SID)).toBe(false);
    expect(inOwnProject(path.join(home, ".claude", "settings.json"), SID)).toBe(false);
    expect(inOwnProject(result, undefined)).toBe(false);
    expect(inOwnProject("", SID)).toBe(false);
  });
});

describe("the secret guard on the session's own project", () => {
  it("lets Read open its tool result and transcripts, by full path or from home", () => {
    expect(verdict("Read", { file_path: result })).toBeNull();
    expect(verdict("Read", { file_path: path.join(mine, "older.jsonl") })).toBeNull();
    expect(verdict("Read", { file_path: `~/.claude/projects/-dev-app/${SID}/tool-results/mcp-board-changelog_list.txt` })).toBeNull();
  });

  it("still refuses another session's project, the settings, a link out, and Read with no session", () => {
    expect(verdict("Read", { file_path: path.join(theirs, `${OTHER}.jsonl`) })).toContain(REFUSED);
    expect(verdict("Read", { file_path: path.join(home, ".claude", "settings.json") })).toContain(REFUSED);
    expect(verdict("Read", { file_path: path.join(mine, "sneaky.jsonl") })).toContain(REFUSED);
    expect(verdict("Read", { file_path: result }, "")).toContain(REFUSED);
    expect(verdict("Read", { file_path: result }, OTHER)).toContain(REFUSED);
  });

  it("never lets a thread write there", () => {
    expect(verdict("Write", { file_path: result, content: "x" })).toContain("CLI's own folder");
    expect(verdict("Edit", { file_path: result, old_string: "a", new_string: "b" })).toContain("CLI's own folder");
  });

  it("opens the folder to LS, Grep and Glob, and nothing past it", () => {
    expect(verdict("LS", { path: mine })).toBeNull();
    expect(verdict("Grep", { pattern: "x", path: mine })).toBeNull();
    expect(verdict("Glob", { pattern: "**/*.txt", path: mine })).toBeNull();
    expect(verdict("Glob", { pattern: `${mine}/**/*.txt` })).toBeNull();
    expect(verdict("LS", { path: theirs })).toContain("CLI's own folder");
    expect(verdict("Grep", { pattern: "x", path: path.join(home, ".claude") })).toContain(REFUSED);
  });

  it("lets Bash read its files, but not walk the folder or reach past it", () => {
    expect(verdict("Bash", { command: `head -c 20000 ${result}` })).toBeNull();
    expect(verdict("Bash", { command: `jq . "${result}" | head` })).toBeNull();
    expect(verdict("Bash", { command: `cat ${theirs}/${OTHER}.jsonl` })).toContain("CLI's own folder");
    expect(verdict("Bash", { command: `cd ${mine}; cat ../-dev-other/${OTHER}.jsonl` })).toContain("CLI's own folder");
    expect(verdict("Bash", { command: `rm -rf ${mine}` })).toContain("CLI's own folder");
    expect(verdict("Bash", { command: `cat ${result} > ~/.claude/settings.json` })).toContain("CLI's own folder");
  });
});

describe("withoutOwnProject", () => {
  const place = (file: string) => placedPath(file);

  it("swaps the session's own files for stand-ins and leaves the rest", () => {
    expect(withoutOwnProject(`cat ${result}`, SID, place)).toBe("cat /tmp/own-project-mcp-board-changelog_list.txt");
    expect(withoutOwnProject(`cat ${theirs}/${OTHER}.jsonl`, SID, place)).toBe(`cat ${theirs}/${OTHER}.jsonl`);
    expect(withoutOwnProject(`ls ${mine}`, SID, place)).toBe(`ls ${mine}`);
    expect(withoutOwnProject(`cat ${mine}/missing.txt`, SID, place)).toBe(`cat ${mine}/missing.txt`);
  });

  it("leaves a command alone with no session or no projects path", () => {
    expect(withoutOwnProject(`cat ${result}`, undefined, place)).toBe(`cat ${result}`);
    expect(withoutOwnProject("ls -la", SID, place)).toBe("ls -la");
  });
});
