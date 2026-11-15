import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

// Where a write may be granted for the rest of a card's life after you allowed one blocked write there once
// (lib/write-grant.ts). Auto mode's classifier won't judge writes into a skill's folder or a Claude settings file
// ("gave no verdict"), so a card building a skill used to ask on every batch of calls. The scope is that skill's
// whole folder, or that one settings file; never wider (not the project, not the home folder), never global.
// A write that changes what's allowed (a settings file's permissions or hooks, a skill's allowed-tools) is never
// covered: it asks every time, because a standing grant there would let the thread widen its own permissions.

export const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

export interface WriteScope {
  // The skill's folder, or the settings file.
  path: string;
  kind: "skill" | "settings";
  // The skill's name, or the settings file's name, for the prompt.
  name: string;
}

// The file a write tool call touches, as an absolute path, or undefined for any other call.
export function writeTarget(toolName: string, input: Record<string, unknown>, cwd: string): string | undefined {
  if (!WRITE_TOOLS.has(toolName)) return undefined;
  const file = input.file_path ?? input.notebook_path;
  return typeof file === "string" && file ? resolve(cwd, file) : undefined;
}

const SETTINGS = /^settings(\.[\w-]+)?\.json$/;
const HOME = homedir();

// The scope a file falls in: a Claude settings file (.claude/settings*.json), else the skill folder holding it,
// which is skills/<name> under any skills folder (plugin/skills, .claude/skills, ~/.claude/skills) or the nearest
// folder with a SKILL.md (a skills repo with no skills/ level). Undefined for anything else, and for a folder
// that is or holds the card's project, which would grant the whole project.
export function scopeFor(file: string, cwd: string, exists: (p: string) => boolean = fileExists): WriteScope | undefined {
  const name = basename(file);
  if (SETTINGS.test(name) && basename(dirname(file)) === ".claude") return { path: file, kind: "settings", name };
  const dir = skillDir(file, exists);
  if (!dir || dir === HOME || dir === dirname(dir) || within(cwd, dir)) return undefined;
  return { path: dir, kind: "skill", name: basename(dir) };
}

function skillDir(file: string, exists: (p: string) => boolean): string | undefined {
  const parts = file.split(sep);
  // The last "skills" with a skill name and something beneath it: skills/<name>/...
  for (let i = parts.length - 3; i > 0; i--) if (parts[i] === "skills") return parts.slice(0, i + 2).join(sep);
  if (basename(file) === "SKILL.md") return dirname(file);
  let dir = dirname(file);
  for (let up = 0; up < 3 && dir !== dirname(dir); up++, dir = dirname(dir)) if (exists(resolve(dir, "SKILL.md"))) return dir;
  return undefined;
}

// Whether path is folder or inside it.
export function within(path: string, folder: string): boolean {
  const rel = relative(folder, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function fileExists(p: string): boolean {
  return readText(p) !== undefined;
}

function readText(p: string): string | undefined {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

// The keys of a settings file that decide what a thread may do: never covered by a standing grant.
export const PERMISSION_KEYS = ["permissions", "hooks", "disableAllHooks", "env", "apiKeyHelper", "sandbox", "enableAllProjectMcpServers", "enabledMcpjsonServers", "disabledMcpjsonServers"];

// Whether this write changes what's allowed: a settings file's permission keys, or a SKILL.md's allowed-tools.
// Anything it can't read for sure (bad JSON, an Edit whose old text isn't there) counts as a change, so it asks.
export function changesPermissions(toolName: string, input: Record<string, unknown>, file: string, read: (p: string) => string | undefined = readText): boolean {
  const name = basename(file);
  const json = SETTINGS.test(name);
  if (!json && name !== "SKILL.md") return false;
  const before = read(file);
  const after = contentAfter(toolName, input, before);
  if (after === undefined) return true;
  if (!json) return allowedTools(before ?? "") !== allowedTools(after);
  const was = parse(before ?? "{}");
  const now = parse(after);
  if (!was || !now) return true;
  return PERMISSION_KEYS.some((k) => JSON.stringify(was[k]) !== JSON.stringify(now[k]));
}

// The file's text once the call has run, or undefined when that can't be worked out.
function contentAfter(toolName: string, input: Record<string, unknown>, before: string | undefined): string | undefined {
  if (toolName === "Write") return typeof input.content === "string" ? input.content : undefined;
  const edits = toolName === "MultiEdit" ? input.edits : toolName === "Edit" ? [input] : undefined;
  if (!Array.isArray(edits) || before === undefined) return undefined;
  let text: string | undefined = before;
  for (const e of edits as Record<string, unknown>[]) text = applyEdit(text, e);
  return text;
}

function applyEdit(text: string | undefined, e: Record<string, unknown>): string | undefined {
  const { old_string: from, new_string: to } = e;
  if (text === undefined || typeof from !== "string" || typeof to !== "string" || !text.includes(from)) return undefined;
  return e.replace_all ? text.split(from).join(to) : text.replace(from, () => to);
}

function parse(text: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

// A SKILL.md frontmatter's allowed-tools, with any list lines under it, as one string to compare.
export function allowedTools(text: string): string {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  const lines = front.split(/\r?\n/);
  const at = lines.findIndex((l) => /^allowed-tools\s*:/.test(l));
  if (at === -1) return "";
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((l) => !/^\s+\S|^\s*-\s/.test(l));
  return [lines[at], ...rest.slice(0, end === -1 ? rest.length : end)].join("\n").trim();
}

// Whether a write call goes through on the card's granted scopes: it falls in one, and changes no permissions.
export function grantedWrite(scopes: string[] | undefined, toolName: string, input: Record<string, unknown>, cwd: string): boolean {
  if (!scopes?.length) return false;
  const file = writeTarget(toolName, input, cwd);
  if (!file || !scopes.some((s) => within(file, s))) return false;
  return !changesPermissions(toolName, input, file);
}

// The words on the prompt and in the retry message: "the research skill", "settings.local.json".
export function scopeLabel(scope: WriteScope): string {
  return scope.kind === "skill" ? `the ${scope.name} skill` : scope.name;
}
