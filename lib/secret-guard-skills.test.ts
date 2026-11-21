import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toolVerdict } from "./secret-guard";
import { fromCwd, placedPath } from "./secret-guard-files";
import { inSkills, skillStandIn, skillsDirs, withoutSkills } from "./secret-guard-skills";

// The CLI's installed skills open to read and run, never to write; the rest of its home stays sealed (2026-11-21: the
// pptx skill's `python ~/.claude/skills/pptx/scripts/office/validate.py` was refused).

const DATA = "/Users/me/.weft";
const REFUSED = "can't be read";
let home: string;
let project: string;
let skills: string;
let script: string;
let outside: string;

beforeAll(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-skills-")));
  const claude = path.join(home, ".claude");
  skills = path.join(claude, "skills");
  script = path.join(skills, "pptx", "scripts", "office", "validate.py");
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, "print('ok')");
  fs.writeFileSync(path.join(skills, "pptx", "SKILL.md"), "# pptx");
  fs.mkdirSync(path.join(claude, "projects", "-other"), { recursive: true });
  fs.writeFileSync(path.join(claude, "projects", "-other", "s.jsonl"), "{}");
  fs.writeFileSync(path.join(claude, "settings.json"), "{}");
  // Links in a skill: to the settings, and to a transcript.
  fs.symlinkSync(path.join(claude, "settings.json"), path.join(skills, "pptx", "settings-link.json"));
  fs.symlinkSync(path.join(claude, "projects", "-other"), path.join(skills, "pptx", "transcripts"));
  // A link out of the CLI's home, to a project's .env, and to a plain file.
  outside = path.join(home, "dev", "app");
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, ".env"), "KEY=x");
  fs.writeFileSync(path.join(outside, "notes.md"), "notes");
  fs.symlinkSync(path.join(outside, ".env"), path.join(skills, "pptx", "env-link"));
  fs.symlinkSync(path.join(outside, "notes.md"), path.join(skills, "pptx", "notes-link.md"));
  // A plugin's skill and its hooks.
  const plugin = path.join(claude, "plugins", "cache", "mkt", "docs", "1.0");
  fs.mkdirSync(path.join(plugin, "skills", "xlsx"), { recursive: true });
  fs.writeFileSync(path.join(plugin, "skills", "xlsx", "recalc.py"), "");
  fs.mkdirSync(path.join(plugin, "hooks"), { recursive: true });
  fs.writeFileSync(path.join(plugin, "hooks", "hooks.json"), "{}");
  project = path.join(home, "dev", "proj");
  fs.mkdirSync(project, { recursive: true });
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

const verdict = (tool: string, input: unknown) => fromCwd(project, () => toolVerdict(tool, input, DATA, undefined, undefined));
const bash = (command: string) => verdict("Bash", { command });

describe("inSkills", () => {
  it("holds the skills folder, a skill's files, and a plugin's skills", () => {
    expect(skillsDirs()).toContain(skills);
    expect(inSkills(skills)).toBe(true);
    expect(inSkills(script)).toBe(true);
    expect(inSkills(path.join(skills, "pptx", "not-yet.py"))).toBe(true);
    expect(inSkills(path.join(home, ".claude", "plugins", "cache", "mkt", "docs", "1.0", "skills", "xlsx", "recalc.py"))).toBe(true);
  });

  it("refuses a `..`, a link back into the CLI's home, the settings, transcripts and a plugin's hooks", () => {
    expect(inSkills(`${skills}/pptx/../../settings.json`)).toBe(false);
    expect(inSkills(path.join(skills, "pptx", "settings-link.json"))).toBe(false);
    expect(inSkills(path.join(skills, "pptx", "transcripts", "s.jsonl"))).toBe(false);
    expect(inSkills(path.join(home, ".claude", "settings.json"))).toBe(false);
    expect(inSkills(path.join(home, ".claude", "projects", "-other", "s.jsonl"))).toBe(false);
    expect(inSkills(path.join(home, ".claude", "plugins", "cache", "mkt", "docs", "1.0", "hooks", "hooks.json"))).toBe(false);
    expect(inSkills("")).toBe(false);
  });

  it("judges a link out of the CLI's home where it lands", () => {
    expect(skillStandIn(path.join(skills, "pptx", "env-link"))).toBe(path.join(outside, ".env"));
    expect(skillStandIn(script)).toBe("/tmp/weft-skill/validate.py");
    expect(skillStandIn(path.join(home, ".claude", "settings.json"))).toBeUndefined();
  });
});

describe("the secret guard on installed skills", () => {
  it("lets Read, LS, Grep and Glob read them, by full path or from home", () => {
    expect(verdict("Read", { file_path: script })).toBeNull();
    expect(verdict("Read", { file_path: "~/.claude/skills/pptx/SKILL.md" })).toBeNull();
    expect(verdict("Read", { file_path: path.join(skills, "pptx", "notes-link.md") })).toBeNull();
    expect(verdict("LS", { path: skills })).toBeNull();
    expect(verdict("Grep", { pattern: "import", path: path.join(skills, "pptx") })).toBeNull();
    expect(verdict("Glob", { pattern: "**/*.py", path: skills })).toBeNull();
    expect(verdict("Glob", { pattern: "~/.claude/skills/**/*.py" })).toBeNull();
  });

  it("never lets Write or Edit change one", () => {
    expect(verdict("Write", { file_path: path.join(skills, "pptx", "SKILL.md"), content: "x" })).toContain(REFUSED);
    expect(verdict("Edit", { file_path: script, old_string: "a", new_string: "b" })).toContain(REFUSED);
    expect(verdict("Write", { file_path: "~/.claude/skills/evil/SKILL.md", content: "x" })).toContain(REFUSED);
  });

  it("keeps links, `..` and the rest of the CLI's home sealed", () => {
    expect(verdict("Read", { file_path: path.join(skills, "pptx", "settings-link.json") })).toContain(REFUSED);
    expect(verdict("Read", { file_path: path.join(skills, "pptx", "env-link") })).toContain(REFUSED);
    expect(verdict("Read", { file_path: `${skills}/pptx/../../settings.json` })).toContain(REFUSED);
    expect(verdict("Read", { file_path: path.join(home, ".claude", "settings.json") })).toContain(REFUSED);
    expect(verdict("Read", { file_path: path.join(home, ".claude", "projects", "-other", "s.jsonl") })).toContain(REFUSED);
    expect(verdict("LS", { path: path.join(skills, "pptx", "transcripts") })).toContain(REFUSED);
  });

  it.each([
    "python3 ~/.claude/skills/pptx/scripts/office/validate.py /tmp/deck.pptx",
    "python3 -I ~/.claude/skills/pptx/scripts/office/validate.py /tmp/deck.pptx",
    "node ~/.claude/skills/pptx/scripts/office/validate.py",
    "~/.claude/skills/pptx/scripts/office/validate.py deck.pptx",
    "cat ~/.claude/skills/pptx/SKILL.md",
    'head -50 "$HOME/.claude/skills/pptx/SKILL.md" | grep -n theme',
    "ls -la ~/.claude/skills",
    "find ~/.claude/skills -name '*.py'",
    "cp ~/.claude/skills/pptx/SKILL.md /tmp/copy.md",
    "cp -r ~/.claude/skills/pptx/scripts ./scripts",
    "wc -l $(ls ~/.claude/skills/pptx/scripts/office/*.py)",
  ])("lets Bash read or run: %s", (command) => {
    expect(bash(command)).toBeNull();
  });

  it.each([
    "rm -rf ~/.claude/skills/pptx",
    "mv ~/.claude/skills/pptx /tmp/x",
    "echo evil > ~/.claude/skills/pptx/SKILL.md",
    "echo evil >> ~/.claude/skills/pptx/SKILL.md",
    "cp /tmp/evil.md ~/.claude/skills/pptx/SKILL.md",
    "cp -t ~/.claude/skills/pptx /tmp/evil.md",
    "tee ~/.claude/skills/pptx/SKILL.md < /tmp/evil.md",
    "sed -i '' s/a/b/ ~/.claude/skills/pptx/SKILL.md",
    "find ~/.claude/skills -name '*.md' -delete",
    "find ~/.claude/skills -exec rm {} ;",
    "python3 ~/.claude/skills/pptx/scripts/office/validate.py ~/.claude/skills/pptx/out.pptx",
    "python3 -c \"open('$HOME/.claude/skills/pptx/SKILL.md','w')\"",
    "bash -c 'rm ~/.claude/skills/pptx/SKILL.md'",
    "cd ~/.claude/skills/pptx && rm SKILL.md",
    "cat ~/.claude/skills/pptx/../../settings.json",
    "cat ~/.claude/skills/pptx/settings-link.json",
    "cat ~/.claude/skills/pptx/env-link",
    "cat ~/.claude/settings.json",
    "cat ~/.claude/projects/-other/s.jsonl",
  ])("refuses in Bash: %s", (command) => {
    expect(bash(command)).toContain(REFUSED);
  });
});

describe("withoutSkills", () => {
  const place = (file: string) => placedPath(file);

  it("swaps a skill's paths on a line that reads or runs them, and leaves the rest", () => {
    expect(withoutSkills(`python3 ${script} a.pptx`, place)).toBe("python3 /tmp/weft-skill/validate.py a.pptx");
    expect(withoutSkills(`rm ${script}`, place)).toBe(`rm ${script}`);
    expect(withoutSkills("ls -la", place)).toBe("ls -la");
    expect(withoutSkills("ls ./skills/x", place)).toBe("ls ./skills/x");
  });
});
