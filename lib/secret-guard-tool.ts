// Why a tool call is turned away, or null to let it run. Each branch is the
// per-tool check: file tools hit isSecretFile, Grep also checks glob, and Bash
// is a thin wrapper around bashVerdict.

import { DATA_DIR } from "./store";
import { refusal } from "./secret-guard-why";
import { bashVerdict } from "./secret-guard-bash";
import { expandBraces, isSecretFile, isWorkerHome, searchesCliHome } from "./secret-guard-files";
import { CLAUDE_SEGMENT, changesCliSettings } from "./secret-guard-cli-home";
import { pastedElsewhere, pastedInto, withoutPasted } from "./secret-guard-pasted";
import { CLONE_REFUSAL, editsClone } from "./worker-clone-guard";

// A file:// URL's path, or "" for any other URL.
function filePath(url: string): string {
  if (!/^file:/i.test(url)) return "";
  const bare = url.replace(/^file:(\/\/)?/i, "").replace(/[?#].*$/, "");
  try {
    return decodeURIComponent(bare);
  } catch {
    return bare;
  }
}

// The tools that name a file. Write is here because a thread that may not read a .env may not
// overwrite one either: it could clobber a secret it is not allowed to see (2026-10-28).
const FILE_TOOLS = new Set(["Read", "Edit", "MultiEdit", "Write", "NotebookRead", "NotebookEdit"]);

// Why a tool call is turned away, or null to let it run. cardId names the thread's card, so a Read of an
// attachment its user pasted gets through (lib/secret-guard-pasted.ts).
export function toolVerdict(toolName: string, input: unknown, dataDir = DATA_DIR, cardId?: string): string | null {
  const fields = (input ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof fields[key] === "string" ? fields[key] : "");
  if (FILE_TOOLS.has(toolName)) return fileVerdict(toolName, str("file_path") || str("notebook_path") || str("path"), dataDir, cardId);
  switch (toolName) {
    case "Grep":
      // ripgrep's globs match dotfiles, so `*.local` reaches .env.local.
      return patternReason(str("path"), expandBraces(str("glob")), dataDir);
    case "Glob":
      // A pattern is a name too: `.env*` and `**/.env` reach a .env file.
      return patternReason(str("path"), expandBraces(str("pattern")), dataDir);
    case "LS":
      // Listing a folder is reading what is in it; a worker's home lists only names (isWorkerHome).
      return isWorkerHome(str("path")) ? null : pathReason(str("path"), dataDir);
    case "mcp__browser__open_url":
      return pathReason(filePath(str("url")), dataDir);
    case "Bash":
      return bashVerdict(withoutPasted(str("command"), cardId, dataDir), dataDir);
    default:
      return null;
  }
}

function fileVerdict(toolName: string, file: string, dataDir: string, cardId: string | undefined): string | null {
  if (toolName === "Read") return readVerdict(file, dataDir, cardId);
  // The worker's own clone is its daemon's code: readable, never changed by a thread (lib/worker-clone-guard.ts).
  if (editsClone(file)) return CLONE_REFUSAL;
  // A project's `.claude/` is open to read, but its settings decide what a thread may do (lib/secret-guard-cli-home.ts).
  if (toolName !== "NotebookRead" && changesCliSettings(file)) return reason(file);
  return isSecretFile(file, dataDir) ? reason(file) : null;
}

// A Read opens an attachment its user pasted, and one pasted on another machine is named as that, not as a secret.
function readVerdict(file: string, dataDir: string, cardId: string | undefined): string | null {
  if (pastedInto(cardId, file, dataDir)) return null;
  return pastedElsewhere(file) ?? (isSecretFile(file, dataDir) ? reason(file) : null);
}

// One path, read as a path.
function pathReason(file: string, dataDir: string): string | null {
  return file && isSecretFile(file, dataDir) ? reason(file) : null;
}

// A glob or a search pattern is a name too: `.env*` and `**/.env` reach a .env
// file, so each candidate is read as a literal name. One that names `.claude` is sealed when the search starts
// where it reaches the CLI's own folder (`.claude/**` from home), and open from a project.
function patternReason(root: string, globs: string[], dataDir: string): string | null {
  const intoCli = searchesCliHome(root);
  const hit = [root, ...globs].find((p) => p && (isSecretFile(p, dataDir, true) || (intoCli && CLAUDE_SEGMENT.test(p))));
  return hit ? reason(hit, true) : null;
}

// In words that fit what the path is (lib/secret-guard-why.ts).
const reason = (what: string, literal = false) => refusal(what, undefined, literal);
