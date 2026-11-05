// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codexProjectInstructions, gooseReadsProjectInstructions, projectInstructions, pukuContext } from "./puku-context";

let dir: string;
const write = (name: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "puku-context-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("projectInstructions", () => {
  it("is empty when the folder has none", () => {
    expect(projectInstructions(dir)).toBe("");
  });

  it("is empty when there's a PUKU.md, which puku-cli loads itself", () => {
    write("PUKU.md", "@AGENTS.md");
    write("AGENTS.md", "use pnpm");
    expect(projectInstructions(dir)).toBe("");
  });

  it("reads CLAUDE.md and AGENTS.md, following @imports once each", () => {
    write("CLAUDE.md", "@AGENTS.md\n\n@docs/SOUL.md");
    write("AGENTS.md", "use pnpm");
    write("docs/SOUL.md", "be kind\n@../AGENTS.md");
    const text = projectInstructions(dir);
    expect(text).toContain(`Contents of ${path.join(dir, "CLAUDE.md")}`);
    expect(text).toContain(`Contents of ${path.join(dir, "docs/SOUL.md")} (project instructions, checked into the codebase):\n\nbe kind`);
    expect(text.match(/use pnpm/g)).toHaveLength(1);
  });

  it("skips an import that isn't there and stops at a deep chain", () => {
    write("AGENTS.md", "@missing.md\n@a1.md");
    for (let i = 1; i <= 6; i++) write(`a${i}.md`, `level ${i}\n@a${i + 1}.md`);
    const text = projectInstructions(dir);
    expect(text).toContain("level 4");
    expect(text).not.toContain("level 5");
  });

  it("keeps a 66 KB CLAUDE.md whole", () => {
    write("CLAUDE.md", "y".repeat(66_000));
    expect(projectInstructions(dir)).not.toContain("[cut at");
  });

  it("cuts a very long one", () => {
    write("AGENTS.md", "x".repeat(110_000));
    const text = projectInstructions(dir);
    expect(text.length).toBeLessThan(101_000);
    expect(text).toMatch(/\[cut at 100000 characters\]$/);
  });
});

describe("codexProjectInstructions", () => {
  it("is empty without a CLAUDE.md, since Codex loads AGENTS.md itself", () => {
    write("AGENTS.md", "use pnpm");
    expect(codexProjectInstructions(dir)).toBe("");
  });

  it("sends CLAUDE.md and its imports but never AGENTS.md", () => {
    write("CLAUDE.md", "@AGENTS.md\n\n@docs/SOUL.md\n\nship small");
    write("AGENTS.md", "use pnpm");
    write("docs/SOUL.md", "be kind");
    const text = codexProjectInstructions(dir);
    expect(text).toContain("ship small");
    expect(text).toContain("be kind");
    expect(text).not.toContain("use pnpm");
  });

  it("cuts a very long one", () => {
    write("CLAUDE.md", "z".repeat(110_000));
    expect(codexProjectInstructions(dir)).toMatch(/\[cut at 100000 characters\]$/);
  });
});

describe("gooseReadsProjectInstructions", () => {
  it("is true when the folder has an AGENTS.md, which Goose loads itself", () => {
    expect(gooseReadsProjectInstructions(dir)).toBe(false);
    write("AGENTS.md", "use pnpm");
    expect(gooseReadsProjectInstructions(dir)).toBe(true);
  });

  it("is false for a folder with only a CLAUDE.md, which Goose reads no", () => {
    write("CLAUDE.md", "ship small");
    expect(gooseReadsProjectInstructions(dir)).toBe(false);
  });
});

describe("pukuContext", () => {
  it("gives the folder, the project's instructions and Weft's prompt in one system-reminder", () => {
    write("AGENTS.md", "use pnpm");
    const text = pukuContext(dir, "WEFT PROMPT");
    expect(text.startsWith("<system-reminder>\n")).toBe(true);
    expect(text).toContain(`Working directory: ${dir}`);
    expect(text).toContain("# Project instructions");
    expect(text).toContain("use pnpm");
    expect(text).toMatch(/# Weft\nWEFT PROMPT\n<\/system-reminder>\n\n$/);
  });

  it("leaves the project section out when there's nothing to load", () => {
    expect(pukuContext(dir, "W")).not.toContain("# Project instructions");
  });

  it("drops project skills named in the off list from the skills section", () => {
    fs.mkdirSync(path.join(dir, ".claude", "skills", "deck"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "skills", "deck", "SKILL.md"), "---\ndescription: Make a deck\n---\n");
    fs.mkdirSync(path.join(dir, ".claude", "skills", "slide"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "skills", "slide", "SKILL.md"), "---\ndescription: Make a slide\n---\n");
    const text = pukuContext(dir, "W", ["deck"]);
    expect(text).toContain("# Skills");
    expect(text).toContain("- slide: Make a slide");
    expect(text).not.toContain("- deck:");
  });
});
