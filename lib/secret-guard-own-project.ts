// The way into the CLI's own folder a thread needs: its own project's, `~/.claude/projects/<project>/`, to read. When an
// MCP tool's answer is too big for the context (changelog_list with 158 entries, ~80k chars), Claude Code writes it to
// `<project>/<session-id>/tool-results/<name>.txt` and tells the thread to read it in chunks; the secret guard sealed all
// of `~/.claude`, so the thread never saw the answer (2026-11-04). The user chose to open the whole project folder: its
// tool results, its sessions' transcripts and its memory. Other projects, the CLI's settings, hooks and skills stay sealed.
//
// The project is found by the hook call's own session_id (the folder holding `<id>.jsonl` or `<id>/`), never by the cwd:
// a thread can `cd` into another repo, but it can't change the session id the CLI hands its hooks. Only reads open
// (lib/secret-guard-tool.ts uses this for Read, Grep, Glob, LS and Bash; Write and Edit still meet the seal).

import fs from "node:fs";
import path from "node:path";
import { cliHomes } from "./secret-guard-cli-home";

// Claude Code's session ids are UUIDs: anything else (empty, a glob, `..`) opens nothing.
const SESSION_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

// Where a path really lands, links followed; one that isn't there yet stands for itself (a glob, a typo).
function real(at: string): string {
  try {
    return fs.realpathSync(at);
  } catch {
    return at;
  }
}

const exists = (at: string) => fs.existsSync(at);

// Each session's project, found once: a session never moves to another project.
const found = new Map<string, string[]>();

// The project folders that hold this session, in each of the CLI's homes. Empty for a session the CLI hasn't written yet.
export function ownProjectDirs(sessionId: string | undefined): string[] {
  if (!sessionId || !SESSION_ID.test(sessionId)) return [];
  const cached = found.get(sessionId);
  if (cached) return cached;
  const dirs = cliHomes(real).flatMap((home) => {
    const projects = path.join(home, "projects");
    let names: string[] = [];
    try {
      names = fs.readdirSync(projects);
    } catch {
      return [];
    }
    return names.map((n) => path.join(projects, n)).filter((d) => exists(path.join(d, `${sessionId}.jsonl`)) || exists(path.join(d, sessionId)));
  });
  const unique = [...new Set(dirs.flatMap((d) => [d, real(d)]))];
  if (unique.length) found.set(sessionId, unique);
  return unique;
}

// macOS folds case, so `~/.CLAUDE` is the same folder.
const under = (at: string, dir: string) => {
  const rel = path.relative(dir.toLowerCase(), at.toLowerCase());
  return !rel || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

// Whether an absolute path (home and the card's cwd already placed) is this session's project folder or in it, both where
// it's named and where it really lands: a link in there to another project, or to `~/.claude/settings.json`, stays sealed.
// A `..` anywhere in the name is refused before it's folded, as the memory folder does.
export function inOwnProject(at: string, sessionId: string | undefined): boolean {
  if (!at || /(?:^|\/)\.\.(?:\/|$)/.test(at)) return false;
  const dirs = ownProjectDirs(sessionId);
  return dirs.length > 0 && [at, real(at)].every((p) => dirs.some((d) => under(p, d)));
}

// A path in a shell command that runs through the CLI's projects folder: `~/.claude/projects/-Users-me-app/x.jsonl`.
const PROJECT_PATH = /(?:~|\$HOME|\/)[^\s'"`;|&<>()]*\/\.claude\/projects\/[^\s'"`;|&<>()]+/gi;

// A plain file, not a folder or a link: `cd <project>; cat ../other/x.jsonl` or `rm -rf <project>` must not get through.
function isPlainFile(at: string): boolean {
  try {
    return fs.lstatSync(at).isFile();
  } catch {
    return false;
  }
}

// The command with each of this project's files swapped for a stand-in outside `~/.claude`, so the Bash check reads what's
// left: `head -c 20000 <tool result>`, `jq` or `grep` on a transcript runs. Folders aren't swapped (the Read, Grep, Glob and
// LS tools open those), and another project's files, and anything else in the CLI's folder, reach the check as they were.
export function withoutOwnProject(command: string, sessionId: string | undefined, place: (file: string) => string): string {
  if (!sessionId || !/\/\.claude\/projects\//i.test(command)) return command;
  return command.replace(PROJECT_PATH, (file) => {
    const at = place(file);
    return isPlainFile(at) && inOwnProject(at, sessionId) ? `/tmp/own-project-${path.basename(file)}` : file;
  });
}
