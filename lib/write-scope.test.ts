import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allowedTools, changesPermissions, grantedWrite, scopeFor, scopeLabel, within, writeTarget } from "./write-scope";

const CWD = "/Users/me/dev/weft";
const none = () => false;

describe("writeTarget", () => {
  it("is the absolute file of a write call, and nothing for other tools", () => {
    expect(writeTarget("Write", { file_path: "plugin/x.md" }, CWD)).toBe(`${CWD}/plugin/x.md`);
    expect(writeTarget("Edit", { file_path: "/a/b.ts" }, CWD)).toBe("/a/b.ts");
    expect(writeTarget("NotebookEdit", { notebook_path: "/a/n.ipynb" }, CWD)).toBe("/a/n.ipynb");
    expect(writeTarget("Bash", { command: "ls" }, CWD)).toBeUndefined();
    expect(writeTarget("Write", {}, CWD)).toBeUndefined();
  });
});

describe("scopeFor", () => {
  it("takes the whole skill folder under any skills folder", () => {
    expect(scopeFor(`${CWD}/plugin/skills/research/kit/research.js`, CWD, none)).toEqual({ path: `${CWD}/plugin/skills/research`, kind: "skill", name: "research" });
    expect(scopeFor(`${CWD}/plugin/skills/research/SKILL.md`, CWD, none)?.path).toBe(`${CWD}/plugin/skills/research`);
    expect(scopeFor("/Users/me/.claude/skills/done/scripts/a.sh", CWD, none)?.path).toBe("/Users/me/.claude/skills/done");
  });

  it("takes the nearest folder with a SKILL.md where there's no skills folder", () => {
    const has = (p: string) => p === "/Users/me/dev/claude-skills/commit/SKILL.md";
    expect(scopeFor("/Users/me/dev/claude-skills/commit/lib/x.js", CWD, has)?.path).toBe("/Users/me/dev/claude-skills/commit");
    expect(scopeFor("/Users/me/dev/claude-skills/new/SKILL.md", CWD, none)?.path).toBe("/Users/me/dev/claude-skills/new");
  });

  it("takes a Claude settings file on its own", () => {
    expect(scopeFor(`${CWD}/.claude/settings.local.json`, CWD, none)).toEqual({ path: `${CWD}/.claude/settings.local.json`, kind: "settings", name: "settings.local.json" });
    expect(scopeFor("/Users/me/.claude/settings.json", CWD, none)?.kind).toBe("settings");
  });

  it("grants nothing for ordinary files, a file directly in skills/, or a skill folder holding the project", () => {
    expect(scopeFor(`${CWD}/lib/runner.ts`, CWD, none)).toBeUndefined();
    expect(scopeFor(`${CWD}/plugin/skills/README.md`, CWD, none)).toBeUndefined();
    expect(scopeFor(`${CWD}/settings.json`, CWD, none)).toBeUndefined();
    expect(scopeFor(`${CWD}/lib/x.ts`, CWD, (p) => p === `${CWD}/SKILL.md`)).toBeUndefined();
    expect(scopeFor("/r/skills/me/x.ts", "/r/skills/me/app", none)).toBeUndefined();
    expect(scopeFor(join(homedir(), "x.md"), CWD, (p) => p === join(homedir(), "SKILL.md"))).toBeUndefined();
  });
});

describe("within", () => {
  it("is the folder itself or anything under it, not a sibling with the same prefix", () => {
    expect(within("/a/b", "/a/b")).toBe(true);
    expect(within("/a/b/c", "/a/b")).toBe(true);
    expect(within("/a/bc", "/a/b")).toBe(false);
    expect(within("/a", "/a/b")).toBe(false);
  });
});

describe("allowedTools", () => {
  it("reads the frontmatter's allowed-tools with its list lines", () => {
    expect(allowedTools("---\nname: x\nallowed-tools: Bash, Read\n---\nbody")).toBe("allowed-tools: Bash, Read");
    expect(allowedTools("---\nallowed-tools:\n  - Bash\n  - Read\nname: x\n---")).toBe("allowed-tools:\n  - Bash\n  - Read");
    expect(allowedTools("---\nname: x\n---\nallowed-tools: Bash")).toBe("");
    expect(allowedTools("no frontmatter")).toBe("");
  });
});

describe("changesPermissions", () => {
  const files: Record<string, string> = {
    "/s/.claude/settings.json": JSON.stringify({ model: "opus", permissions: { allow: ["Read"] } }),
    "/k/SKILL.md": "---\nname: k\nallowed-tools: Read\n---\nDo it.",
    "/b/.claude/settings.json": "{ broken",
  };
  const read = (p: string) => files[p];

  it("ignores files that aren't settings or a SKILL.md", () => {
    expect(changesPermissions("Write", { content: "x" }, "/k/kit/a.js", read)).toBe(false);
  });

  it("lets a settings change through when its permission keys stay as they were", () => {
    const content = JSON.stringify({ model: "sonnet", permissions: { allow: ["Read"] } });
    expect(changesPermissions("Write", { content }, "/s/.claude/settings.json", read)).toBe(false);
    expect(changesPermissions("Edit", { old_string: '"opus"', new_string: '"sonnet"' }, "/s/.claude/settings.json", read)).toBe(false);
  });

  it("asks for a change to permissions or hooks, unreadable JSON, or an edit it can't place", () => {
    expect(changesPermissions("Edit", { old_string: '["Read"]', new_string: '["Read","Bash"]' }, "/s/.claude/settings.json", read)).toBe(true);
    expect(changesPermissions("Write", { content: JSON.stringify({ model: "opus", permissions: { allow: ["Read"] }, hooks: {} }) }, "/s/.claude/settings.json", read)).toBe(true);
    expect(changesPermissions("Write", { content: "{ nope" }, "/s/.claude/settings.json", read)).toBe(true);
    expect(changesPermissions("Write", { content: "[]" }, "/s/.claude/settings.json", read)).toBe(true);
    expect(changesPermissions("Edit", { old_string: "missing", new_string: "x" }, "/s/.claude/settings.json", read)).toBe(true);
    expect(changesPermissions("Edit", { old_string: "x" }, "/s/.claude/settings.json", read)).toBe(true);
    expect(changesPermissions("NotebookEdit", {}, "/s/.claude/settings.json", read)).toBe(true);
    expect(changesPermissions("Write", { content: "{}" }, "/b/.claude/settings.json", read)).toBe(true);
  });

  it("treats a missing settings file as empty, so a new one with no permissions goes through", () => {
    expect(changesPermissions("Write", { content: '{"model":"opus"}' }, "/n/.claude/settings.local.json", read)).toBe(false);
    expect(changesPermissions("Write", { content: '{"permissions":{}}' }, "/n/.claude/settings.local.json", read)).toBe(true);
    expect(changesPermissions("Edit", { old_string: "a", new_string: "b" }, "/n/.claude/settings.local.json", read)).toBe(true);
  });

  it("asks when a SKILL.md's allowed-tools change, not when its body does", () => {
    expect(changesPermissions("Edit", { old_string: "Do it.", new_string: "Do it well." }, "/k/SKILL.md", read)).toBe(false);
    expect(changesPermissions("Edit", { old_string: "allowed-tools: Read", new_string: "allowed-tools: Read, Bash" }, "/k/SKILL.md", read)).toBe(true);
    expect(changesPermissions("Write", { content: "---\nname: n\nallowed-tools: Bash\n---" }, "/new/SKILL.md", read)).toBe(true);
    expect(changesPermissions("Write", { content: "---\nname: n\n---\nbody" }, "/new/SKILL.md", read)).toBe(false);
  });

  it("applies MultiEdit's edits in order, and replace_all everywhere", () => {
    const edits = [{ old_string: "opus", new_string: "haiku" }, { old_string: "haiku", new_string: "sonnet" }];
    expect(changesPermissions("MultiEdit", { edits }, "/s/.claude/settings.json", read)).toBe(false);
    expect(changesPermissions("Edit", { old_string: '"', new_string: "'", replace_all: true }, "/s/.claude/settings.json", read)).toBe(true);
  });

  it("reads the real file by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "write-scope-"));
    mkdirSync(join(dir, ".claude"));
    const file = join(dir, ".claude", "settings.json");
    writeFileSync(file, '{"permissions":{"allow":[]}}');
    expect(changesPermissions("Write", { content: '{"permissions":{"allow":[]},"model":"x"}' }, file)).toBe(false);
    expect(changesPermissions("Write", { content: '{"model":"x"}' }, file)).toBe(true);
  });
});

describe("grantedWrite", () => {
  const skill = `${CWD}/plugin/skills/research`;

  it("lets a write inside a granted folder through, and nothing else", () => {
    expect(grantedWrite([skill], "Write", { file_path: `${skill}/kit/a.css`, content: "x" }, CWD)).toBe(true);
    expect(grantedWrite([skill], "Edit", { file_path: "playbooks/x.md" }, skill)).toBe(true);
    expect(grantedWrite([skill], "Write", { file_path: `${CWD}/plugin/skills/other/a.md`, content: "x" }, CWD)).toBe(false);
    expect(grantedWrite([skill], "Bash", { command: `rm -rf ${skill}` }, CWD)).toBe(false);
    expect(grantedWrite([], "Write", { file_path: `${skill}/a`, content: "x" }, CWD)).toBe(false);
    expect(grantedWrite(undefined, "Write", { file_path: `${skill}/a`, content: "x" }, CWD)).toBe(false);
  });

  it("still asks for a granted skill's allowed-tools change", () => {
    const dir = mkdtempSync(join(tmpdir(), "write-scope-skill-"));
    expect(grantedWrite([dir], "Write", { file_path: join(dir, "SKILL.md"), content: "---\nallowed-tools: Bash\n---" }, CWD)).toBe(false);
    expect(grantedWrite([dir], "Write", { file_path: join(dir, "SKILL.md"), content: "---\nname: x\n---" }, CWD)).toBe(true);
  });
});

describe("scopeLabel", () => {
  it("names a skill by its folder and a settings file by its name", () => {
    expect(scopeLabel({ path: "/a/skills/research", kind: "skill", name: "research" })).toBe("the research skill");
    expect(scopeLabel({ path: "/a/.claude/settings.json", kind: "settings", name: "settings.json" })).toBe("settings.json");
  });
});
