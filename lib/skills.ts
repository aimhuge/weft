import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SkillInfo } from "./types";

// Weft's own skills live in plugin/, a Claude Code plugin named "weft" that every thread loads
// (see drive() in lib/runner.ts), so they run as /weft:<name>. The packaged app keeps the folder
// next to its server and says where with WEFT_PLUGIN_DIR (see electron/server.cjs).
export const PLUGIN_DIR = process.env.WEFT_PLUGIN_DIR || path.join(process.cwd(), "plugin");
const PLUGIN_NAME = "weft";

// A skill name as it follows the slash: "done", or "weft:done" for a plugin's.
export const SKILL_NAME = /^[\w.-]+(:[\w.-]+)?$/;

// The name and description from a SKILL.md's frontmatter, including folded (>) and block (|) values.
function frontmatter(text: string): Record<string, string> {
  const body = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  if (body === undefined) return {};
  const fields: Record<string, string> = {};
  const lines = body.split(/\r?\n/);
  const isContinuation = (line: string | undefined) => line !== undefined && (/^\s+\S/.test(line) || line.trim() === "");
  for (let i = 0; i < lines.length; i++) {
    const [, key, rest] = lines[i]?.match(/^([\w-]+):\s*(.*)$/) ?? [];
    if (key === undefined || rest === undefined) continue;
    let value = rest.trim();
    if (value === "" || /^[|>][-+]?$/.test(value)) {
      const block: string[] = [];
      while (isContinuation(lines[i + 1])) block.push((lines[++i] ?? "").trim());
      value = block.join(" ").trim();
    }
    fields[key] = value.replace(/^(["'])(.*)\1$/, "$2");
  }
  return fields;
}

type FoundSkill = SkillInfo & { file: string };

function readSkills(dir: string, source: SkillInfo["source"], prefix = ""): FoundSkill[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const skills: FoundSkill[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const file = path.join(dir, entry, "SKILL.md");
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const meta = frontmatter(text);
    // Without one, Claude Code describes a skill by its first line of text, and so does this.
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
    const description = meta.description || (body.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "").trim();
    skills.push({
      name: `${prefix}${meta.name || entry}`,
      description: description.length > 240 ? `${description.slice(0, 239)}…` : description,
      source,
      file,
    });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

// Weft's, the folder's own (when given) and yours in ~/.claude/skills, with the SKILL.md each came from.
function foundSkills(cwd?: string): FoundSkill[] {
  const weft = readSkills(path.join(PLUGIN_DIR, "skills"), "weft", `${PLUGIN_NAME}:`);
  const project = cwd ? readSkills(path.join(cwd, ".claude", "skills"), "project") : [];
  const user = readSkills(path.join(os.homedir(), ".claude", "skills"), "user");
  // A project skill wins over a personal one with the same name, as in Claude Code.
  const inProject = new Set(project.map((s) => s.name));
  return [...weft, ...project, ...user.filter((s) => !inProject.has(s.name))];
}

// The skills a thread can run: Weft's, the folder's own (when given), and yours in ~/.claude/skills.
export function listSkills(cwd?: string): SkillInfo[] {
  return foundSkills(cwd).map(({ name, description, source }) => ({ name, description, source }));
}

// Each skill's folder, for the scan (lib/skill-scan-library.ts).
export function skillDirs(cwd?: string): { name: string; dir: string }[] {
  return foundSkills(cwd).map(({ name, file }) => ({ name, dir: path.dirname(file) }));
}

// Puku and Codex don't look in .claude/skills (puku reads .puku-cli/skills, Codex .agents/skills), and Codex
// has no plugin for Weft's own either. `weft` says whether to list those: puku loads them as a plugin. `off` is the
// card's skill set's off-list (lib/skill-sets.ts); a /name for one of those still runs, through skillInvocation.
export function skillIndex(cwd: string, { weft, off = [] }: { weft: boolean; off?: string[] }): string {
  const hidden = new Set(off);
  const skills = foundSkills(cwd).filter((s) => (weft || s.source !== "weft") && !hidden.has(s.name));
  if (!skills.length) return "";
  const lines = skills.map((s) => `- ${s.name}: ${s.description} (${s.file})`);
  return `# Skills\nThese skills are not loaded as slash commands in this CLI. When the user types /<name>, or a task matches one, read its SKILL.md and follow it (\${CLAUDE_SKILL_DIR} is the folder it sits in).\n${lines.join("\n")}`;
}

// A message that is just `/name args` for a skill, as the instructions to follow (the CLI can't run it as a slash
// command). Anything else comes back as it was. `weft` lets Weft's own skills through, as for skillIndex.
export function skillInvocation(text: string, cwd: string, { weft }: { weft: boolean }): string {
  const match = /^\/([\w.-]+(?::[\w.-]+)?)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return text;
  const name = match[1] ?? "";
  const args = match[2] ?? "";
  const skills = foundSkills(cwd).filter((s) => weft || s.source !== "weft");
  // The exact name first, so a project's /done beats Weft's /weft:done, which a bare /done falls back to.
  const skill = skills.find((s) => s.name === name) ?? skills.find((s) => s.name === `${PLUGIN_NAME}:${name}`);
  if (!skill) return text;
  const directory = path.dirname(skill.file);
  try {
    const contents = fs.readFileSync(skill.file, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, "");
    const owner = skill.source === "weft" ? "Weft skill" : "skill";
    return `Follow this ${owner} for the current turn. It is not available as a slash command in this CLI, so use these instructions directly.\n\n${contents.replaceAll("${CLAUDE_SKILL_DIR}", directory).replaceAll("${ARGUMENTS}", args)}`;
  } catch {
    return text;
  }
}
