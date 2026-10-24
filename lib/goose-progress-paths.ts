// The file paths a Goose progress note mentions (docs/architecture/goose.md).
//
// Goose's `NotificationData` has no structured payload: a notification is a human-readable progress
// string, and the only way to learn what a turn touched is to read that string. So this is the parsing
// half of the overlap warning for Goose cards: the paths a progress note names, and nothing else.
//
// The shapes it reads come from Goose's own developer extension, which reports a file it wrote as
// "Wrote src/foo.ts (42 lines)", a file it created as "Created src/foo.ts (3 lines)" and a file it
// edited as "Edited src/foo.ts (10 lines -> 12 lines)". Other extensions say their own thing, so the
// rule is the general one: a path is a run of path characters, and a run is a path only when it looks
// like a file path rather than a flag, a URL or a bare word.
//
// The paths come back as the note wrote them — relative to the card's folder, or absolute. Resolving
// them and keeping the ones that sit inside the card's own folder is the caller's job
// (lib/goose-runner.ts's noteFileChanges), because that is where the card's folder lives.
//
// Pure: no fs, no env, no globals. Everything it needs is the progress string it is given.

/** The characters a path may hold: letters, digits, and the marks a file name uses. */
const PATH_RUN = /[A-Za-z0-9._~\-/]+/g;

/** A path has a separator (src/foo.ts) or an extension (notes.md) — otherwise it is a bare word. */
const HAS_EXTENSION = /\.[A-Za-z0-9]+$/;

/**
 * A URL or a scheme: "https://example.com/x", "file:///tmp/x", "mailto:me@example.com".
 *
 * The whole thing is matched and thrown away before the paths are read, because a URL's tail looks
 * exactly like a path ("example.com/docs/readme.md") and must not be read as one.
 *
 * The scheme has to open on a word boundary, so the "ts:" inside "src/foo.ts:42" is not read as a
 * scheme: a real scheme ("https", "file", "mailto") is a whole word before its colon.
 */
const URL = /(?<![A-Za-z0-9._~\-/])[A-Za-z][A-Za-z0-9+.-]*:(?:\/\/)?[^\s"')<>]*/g;

/** A flag: it opens with a dash, so it is never a path. */
const FLAG = /^-[^\s]*$/;

/**
 * Whether a run of text is a file path rather than something else that looks like one.
 *
 * Two things are not paths, and each has its own reason:
 *
 * - A flag ("--verbose", "-f"): it opens with a dash.
 * - A bare word ("Running", "tests"): it has no separator and no extension, so it names no file.
 */
function looksLikePath(run: string): boolean {
  if (FLAG.test(run)) return false;
  // A home-relative path ("~/notes.md") is a path; a bare "~" is not.
  if (run === "~" || run === "~/") return false;
  if (!run.includes("/") && !HAS_EXTENSION.test(run)) return false;
  return true;
}

/** A path without the trailing period a sentence leaves on it ("Wrote src/foo.ts."). */
function trimDots(run: string): string {
  let end = run.length;
  while (end > 0 && run[end - 1] === ".") end--;
  return run.slice(0, end);
}

/**
 * The paths a progress note mentions, in the order they appear, with the repeats removed.
 *
 * A path has to open on a boundary: the run before it may not be part of a word, so "src/foo.ts" in a
 * sentence is a path while "mysrc/foo.ts" is not split into two.
 */
export function progressPaths(progress: string): string[] {
  if (!progress) return [];
  // The URLs come out first, so what is left has no scheme in it.
  const text = progress.replace(URL, " ");
  const found: string[] = [];
  const seen = new Set<string>();
  const pattern = new RegExp(`(?<![A-Za-z0-9._~-])${PATH_RUN.source}`, "g");
  for (const match of text.matchAll(pattern)) {
    const run = trimDots(match[0]);
    if (!looksLikePath(run)) continue;
    if (seen.has(run)) continue;
    seen.add(run);
    found.push(run);
  }
  return found;
}
