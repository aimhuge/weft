import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toolVerdict } from "./secret-guard";
import { fromCwd } from "./secret-guard-files";
import { changesCliSettings, cliHomes, holdsCliHome, inCliHome } from "./secret-guard-cli-home";

// The CLI's home stays sealed; a project's checked-in `.claude/` is open to read, but not its settings to change
// (2026-11-03: a card couldn't read its own project's release skill).

const DATA = "/Users/me/.weft";
const REFUSED = "can't be read";
let home: string;
let project: string;
let linked: string;

beforeAll(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-cli-home-")));
  fs.mkdirSync(path.join(home, ".claude", "projects", "-x"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "projects", "-x", "s.jsonl"), "{}");
  project = path.join(home, "dev", "app");
  fs.mkdirSync(path.join(project, ".claude", "skills", "release"), { recursive: true });
  fs.writeFileSync(path.join(project, ".claude", "skills", "release", "SKILL.md"), "# release");
  fs.writeFileSync(path.join(project, ".claude", "settings.json"), "{}");
  // A project whose `.claude` is a link into the CLI's home.
  linked = path.join(home, "dev", "sneaky");
  fs.mkdirSync(linked, { recursive: true });
  fs.symlinkSync(path.join(home, ".claude"), path.join(linked, ".claude"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

const inProject = (tool: string, input: unknown, cwd = project) => fromCwd(cwd, () => toolVerdict(tool, input, DATA));

describe("a project's own .claude folder", () => {
  it.each([
    ["Read", { file_path: ".claude/skills/release/SKILL.md" }],
    ["Read", { file_path: "PROJECT/.claude/skills/release/SKILL.md" }],
    ["Read", { file_path: "PROJECT/.claude/settings.json" }],
    ["Write", { file_path: "PROJECT/.claude/skills/new/SKILL.md" }],
    ["Edit", { file_path: "PROJECT/.claude/agents/reviewer.md" }],
    ["Glob", { pattern: ".claude/skills/*/SKILL.md" }],
    ["Grep", { glob: ".claude/**/*.md", path: "PROJECT" }],
    ["LS", { path: "PROJECT/.claude" }],
    ["Bash", { command: "cat .claude/skills/release/SKILL.md" }],
    ["Bash", { command: "ls .claude/skills" }],
  ])("lets %s %j read it", (tool, input) => {
    const named: unknown = JSON.parse(JSON.stringify(input).replace("PROJECT", project));
    expect(inProject(tool, named)).toBeNull();
  });

  it.each([
    ["Write", { file_path: "PROJECT/.claude/settings.json" }],
    ["Edit", { file_path: ".claude/settings.local.json" }],
    ["MultiEdit", { file_path: "PROJECT/.claude/settings.json" }],
    ["Bash", { command: "echo {} > .claude/settings.json" }],
    ["Bash", { command: "sed -i '' s/a/b/ .claude/*.json" }],
    ["Bash", { command: "rm -rf .claude" }],
    ["Bash", { command: "cp -r evil/ .claude/" }],
  ])("keeps %s %j from changing its settings", (tool, input) => {
    const named: unknown = JSON.parse(JSON.stringify(input).replace("PROJECT", project));
    expect(inProject(tool, named)).toContain("CLI settings file");
  });
});

describe("the CLI's own folder", () => {
  it.each([
    ["Read", { file_path: "~/.claude/settings.json" }],
    ["Read", { file_path: "HOME/.claude/projects/-x/s.jsonl" }],
    ["Read", { file_path: "../../.claude/projects/-x/s.jsonl" }],
    ["Read", { file_path: "/Users/someone/.claude/projects/-x/s.jsonl" }],
    ["Bash", { command: "cat ../../.claude/projects/-x/s.jsonl" }],
    ["Bash", { command: "cd ~ && cat .claude/projects/-x/s.jsonl" }],
    ["Glob", { pattern: ".claude/**/*.jsonl", path: "~" }],
    ["Grep", { glob: "**/.claude/**", path: "HOME" }],
  ])("keeps %s %j sealed from a project", (tool, input) => {
    const named: unknown = JSON.parse(JSON.stringify(input).replace("HOME", home));
    expect(inProject(tool, named)).toContain(REFUSED);
  });

  it("is sealed through a project's link into it", () => {
    expect(inProject("Read", { file_path: ".claude/projects/-x/s.jsonl" }, linked)).toContain(REFUSED);
    expect(inProject("Bash", { command: "cat .claude/projects/-x/s.jsonl" }, linked)).toContain(REFUSED);
  });

  it("is sealed by a relative name from home", () => {
    expect(inProject("Read", { file_path: ".claude/projects/-x/s.jsonl" }, home)).toContain(REFUSED);
  });
});

describe("helpers", () => {
  const real = (p: string) => p;

  it("counts CLAUDE_CONFIG_DIR as the CLI's home", () => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", "/opt/cli-config");
    expect(cliHomes(real)).toContain("/opt/cli-config");
    expect(inCliHome("/opt/cli-config/projects/a.jsonl", real)).toBe(true);
    vi.unstubAllEnvs();
  });

  it("knows which search roots walk into it", () => {
    expect(holdsCliHome(home, real)).toBe(true);
    expect(holdsCliHome(project, real)).toBe(false);
  });

  it.each([
    [".claude/settings.json", false, true],
    ["a/.claude/settings.local.json", false, true],
    [".claude/*", false, true],
    [".claude/settings.json.bak", false, false],
    [".claude/skills/settings.json", false, false],
    [".claude", false, false],
    [".claude", true, true],
    ["'.claude/'", true, true],
  ])("changesCliSettings(%s, folder %s) is %s", (file, folder, want) => {
    expect(changesCliSettings(file, folder)).toBe(want);
  });
});
