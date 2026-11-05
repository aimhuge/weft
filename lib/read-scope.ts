import fs from "node:fs";
import path from "node:path";

// The thread's "I can only read files inside <project>" auto-mode prompt comes from the CLI's
// working-directory gate. When the agent adapts by asking the user to paste the file or by asking
// which folder to use, the question text usually names the outside path. The board surfaces a
// one-click "Read from <path>" button on those questions so the user doesn't have to paste the
// file. Pure helpers below: the path detection lives next to the card field it backs (Card.readScope).

// A path-looking token: absolute (/...), home-relative (~/...), or relative with at least two
// segments (foo/bar, ../foo, ./foo). The agent's questions often describe paths as
// "~/dev/deckcp/src/app/(site)/login/page.tsx", so we accept those too.
const PATH_TOKEN = /(?:~|\.{1,2}|(?:\/|\.\/))[^"\s'`(),<>|]+|\b[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.()\[\]\- ]+)+\.[A-Za-z0-9]+/g;
// `~/dev/deckcp/src/app/(site)/login/page.tsx` — the shell form. We unquote before matching.
const HOME_PATH = /~\/[^\s"'`,)<>|]+/g;

// One captured path that the question text references, with the directory the user would
// approve. Only the directory is actionable; the agent already named the file.
export interface OutsidePath {
  // The directory the user would be granting read access to (parent of a file, or the path itself).
  directory: string;
  // The original token the question text used, so the button can show it (e.g. "~/dev/deckcp/...").
  token: string;
}

// Whether the path is inside cwd (so the working-directory gate already lets the thread read it).
function isInside(child: string, cwd: string): boolean {
  if (!child) return false;
  try {
    const rel = path.relative(cwd, child);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

// What the token resolves to on disk, in this order:
//   - $HOME for a "~" or "~/foo"
//   - the cwd if the token is relative and lives there
//   - the literal absolute path
// Returns undefined when the token doesn't look like a path, can't be resolved, or points at a
// place that doesn't exist (so the suggestion stays out of the button list).
function resolveToken(token: string, cwd: string): { absolute: string; kind: "file" | "dir" } | undefined {
  const home = process.env.HOME;
  let absolute: string;
  if (token.startsWith("~")) {
    if (!home) return undefined;
    absolute = path.join(home, token.slice(1).replace(/^\/+/, ""));
  } else if (path.isAbsolute(token)) {
    absolute = token;
  } else if (token.startsWith(".") || token.includes("/")) {
    absolute = path.resolve(cwd, token);
  } else {
    return undefined;
  }
  try {
    const stat = fs.statSync(absolute);
    return { absolute, kind: stat.isDirectory() ? "dir" : "file" };
  } catch {
    // The path doesn't exist, but a directory we'd create the parent for is still meaningful.
    // `foo.txt` typed in chat isn't; only paths that look real enough to fall through here.
    return undefined;
  }
}

// For a file token, the user really means the project that holds it, not the leaf folder.
// One level up: the agent's questions usually name a file deep inside a project, and the project
// root is `path.dirname(file)`'s parent. We stop at the first directory that contains a marker
// file or directory a project usually has (a `package.json`, `pyproject.toml`, `.git`, `Cargo.toml`).
// Falls back to one level up if none of those are present.
function projectRoot(file: string, cwd: string): string {
  const parent = path.dirname(file);
  if (isInside(parent, cwd)) return cwd;
  // Walk up from the file's parent. If we find a project marker before reaching cwd, that's the root.
  let dir = parent;
  while (dir && dir !== "/" && dir !== ".") {
    if (isInside(dir, cwd)) return cwd;
    if (hasProjectMarker(dir)) return dir;
    const next = path.dirname(dir);
    if (next === dir) break;
    dir = next;
  }
  // No marker; default to one level up from the file (the most common case for `src/...`).
  return parent;
}

const MARKERS = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", ".git", "pom.xml", "build.gradle"];
function hasProjectMarker(dir: string): boolean {
  for (const m of MARKERS) {
    try {
      if (fs.statSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, m)).isFile() || fs.statSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, m)).isDirectory()) return true;
    } catch {
      // missing
    }
  }
  return false;
}

// Pick out directories outside cwd that the question is asking about. The button shows the
// shortest token (so `~/dev/deckcp` wins over `~/dev/deckcp/src/app/...`), and we only surface
// one suggestion per question — a long list is noise.
export function suggestReadScope(question: string, cwd: string): OutsidePath | undefined {
  if (!question || !cwd) return undefined;
  const candidates = new Map<string, OutsidePath>();
  // Unwrap common shell-quoting the agent uses: `~/'dev/deckcp'`, `~/dev/deckcp"/foo`, etc.
  const cleaned = question.replace(/[`]/g, " ").replace(/['"]/g, "");
  for (const re of [HOME_PATH, PATH_TOKEN]) {
    re.lastIndex = 0;
    for (const match of cleaned.matchAll(re)) {
      const token = match[0].replace(/[.,;:!?]+$/, "");
      if (!token) continue;
      const resolved = resolveToken(token, cwd);
      if (!resolved) continue;
      const directory = resolved.kind === "dir" ? resolved.absolute : projectRoot(resolved.absolute, cwd);
      if (isInside(directory, cwd)) continue;
      // Keep the shortest token for the same directory so the button reads naturally.
      const existing = candidates.get(directory);
      if (!existing || token.length < existing.token.length) {
        candidates.set(directory, { directory, token });
      }
    }
  }
  if (!candidates.size) return undefined;
  // Prefer the one the user would most likely mean: the one whose path was literally named,
  // breaking ties by shortest.
  return [...candidates.values()].sort((a, b) => a.token.length - b.token.length)[0];
}

// Adds a directory to a card's read scope, deduping and dropping anything already inside cwd.
export function withReadScope(existing: string[] | undefined, directory: string, cwd: string): string[] {
  const set = new Set((existing ?? []).filter((d) => d && !isInside(d, cwd)));
  set.add(directory);
  return [...set];
}
