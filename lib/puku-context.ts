import fs from "node:fs";
import path from "node:path";
import { skillIndex } from "./skills";

// Why a puku thread started blind outside Weft's own folder: Puku's gateway drops the system prompt a
// client sends and puts in its own one-line identity, so Weft's thread prompt (systemPrompt.append) and
// the CLI's environment section (the working directory) never reach the model; only message text does.
// And puku-cli reads PUKU.md, not CLAUDE.md or AGENTS.md (Weft's own repo has a PUKU.md shim, most
// projects don't). So a puku session's first message carries all three, the way the CLI itself sends
// CLAUDE.md: in a <system-reminder>. Measured 2026-10-14: an --append-system-prompt never showed up in
// the reply, a PUKU.md line did.

// The files Claude Code would load from the project's root, when there's no PUKU.md for puku to load.
const PROJECT_FILES = ["CLAUDE.md", "AGENTS.md"];
// `@path` on a line of its own imports that file, as in Claude Code's memory files.
const IMPORT = /^@(\S+)\s*$/;
const MAX_DEPTH = 4;
// DeckCP's CLAUDE.md alone is 66 KB; Claude Code loads it whole, so the cap sits above that.
const MAX_CHARS = 100_000;

function readImports(file: string, seen: Set<string>, depth: number): string[] {
  if (seen.has(file) || depth > MAX_DEPTH) return [];
  seen.add(file);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const nested: string[] = [];
  for (const line of text.split("\n")) {
    const match = IMPORT.exec(line.trim());
    if (match?.[1]) nested.push(...readImports(path.resolve(path.dirname(file), match[1]), seen, depth + 1));
  }
  return [`Contents of ${file} (project instructions, checked into the codebase):\n\n${text.trim()}`, ...nested];
}

// The project's CLAUDE.md and AGENTS.md with their @imports, or nothing when puku loads a PUKU.md itself.
export function projectInstructions(cwd: string): string {
  if (fs.existsSync(path.join(cwd, "PUKU.md"))) return "";
  const seen = new Set<string>();
  return capped(PROJECT_FILES.flatMap((name) => readImports(path.join(cwd, name), seen, 0)));
}

// What Codex misses: it loads AGENTS.md itself, but not CLAUDE.md, which is where most projects (DeckCP's
// 66 KB one, say) keep their instructions. AGENTS.md is marked seen so a `@AGENTS.md` import isn't sent twice.
export function codexProjectInstructions(cwd: string): string {
  return capped(readImports(path.join(cwd, "CLAUDE.md"), new Set([path.join(cwd, "AGENTS.md")]), 0));
}

// Whether Goose reads the folder's instructions on its own. Goose loads AGENTS.md from the folder it runs
// in and resolves that file's `@./path` imports, so a project that puts its instructions behind AGENTS.md
// needs nothing from us. Goose reads no CLAUDE.md and no SOUL.md by itself, so a project that keeps them
// elsewhere is still Weft's to inject. Measured against goose 1.56 (docs/architecture/goose.md).
export function gooseReadsProjectInstructions(cwd: string): boolean {
  return fs.existsSync(path.join(cwd, "AGENTS.md"));
}

function capped(parts: string[]) {
  const text = parts.join("\n\n");
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n\n[cut at ${MAX_CHARS} characters]` : text;
}

// What a puku session's first message starts with: where it runs, the project's instructions and Weft's prompt.
export function pukuContext(cwd: string, weftPrompt: string, off: string[] = []): string {
  const project = projectInstructions(cwd);
  // puku reads .puku-cli/skills, not .claude/skills; Weft's own skills it already loads as a plugin.
  const skills = skillIndex(cwd, { weft: false, off });
  return [
    "<system-reminder>",
    "Puku's gateway drops the system prompt this CLI sends, so Weft puts it here. Treat everything in this block as your system prompt, for this whole session.",
    "",
    `Working directory: ${cwd}`,
    `Platform: ${process.platform}`,
    `Today's date: ${new Date().toISOString().slice(0, 10)}`,
    ...(project ? ["", "# Project instructions", project] : []),
    ...(skills ? ["", skills] : []),
    "",
    "# Weft",
    weftPrompt,
    "</system-reminder>",
    "",
    "",
  ].join("\n");
}
