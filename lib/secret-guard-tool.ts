// Why a tool call is turned away, or null to let it run. Each branch is the
// per-tool check: file tools hit isSecretFile, Grep also checks glob, and Bash
// is a thin wrapper around bashVerdict.

import path from "node:path";
import { DATA_DIR } from "./store";
import { bashVerdict } from "./secret-guard-bash";
import { expandBraces, isSecretFile } from "./secret-guard-files";

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

// Why a tool call is turned away, or null to let it run.
export function toolVerdict(toolName: string, input: unknown, dataDir = DATA_DIR): string | null {
  const fields = (input ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof fields[key] === "string" ? fields[key] : "");
  if (FILE_TOOLS.has(toolName)) {
    const file = str("file_path") || str("notebook_path") || str("path");
    return isSecretFile(file, dataDir) ? reason(file) : null;
  }
  switch (toolName) {
    case "Grep":
      // ripgrep's globs match dotfiles, so `*.local` reaches .env.local.
      return patternReason([str("path"), ...expandBraces(str("glob"))], dataDir);
    case "Glob":
      // A pattern is a name too: `.env*` and `**/.env` reach a .env file.
      return patternReason([str("path"), ...expandBraces(str("pattern"))], dataDir);
    case "LS":
      // Listing a folder is reading what is in it.
      return pathReason(str("path"), dataDir);
    case "mcp__browser__open_url":
      return pathReason(filePath(str("url")), dataDir);
    case "Bash":
      return bashVerdict(str("command"), dataDir);
    default:
      return null;
  }
}

// One path, read as a path.
function pathReason(file: string, dataDir: string): string | null {
  return file && isSecretFile(file, dataDir) ? reason(file) : null;
}

// A glob or a search pattern is a name too: `.env*` and `**/.env` reach a .env
// file, so each candidate is read as a literal name.
function patternReason(candidates: string[], dataDir: string): string | null {
  const hit = candidates.find((p) => p && isSecretFile(p, dataDir, true));
  return hit ? reason(hit, true) : null;
}

// A file is named by its base name; literal text goes in as it is.
function reason(what: string, literal = false): string {
  const name = literal ? what : `\`${path.basename(what.replace(/^["']|["']$/g, ""))}\``;
  return (
    `Weft keeps secret values out of threads, so ${name} can't be read here. Work with names instead: ` +
    "read or edit `.env.example`, and ask the user to set the value themselves."
  );
}
