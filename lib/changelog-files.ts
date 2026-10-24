// Which files a changelog entry (lib/changelog.ts) is about, so a commit stamps only the entries it carries. Cards
// share one working tree, and a thread's Bash call can commit another card's work: stamping every draft of the card on
// any commit put the quota card's sha on the preview card's entry. An entry names its files when it's added
// (changelog_add's `files`); an older one, or one added without them, is read for the backticked paths in its text.

// What a backticked path in an entry's text ends with: code, config, docs and assets, not `process.env` or `1.2.0`.
const EXTENSIONS = /\.(?:[cm]?[jt]sx?|json|md|mdx|css|scss|html|sql|sh|ya?ml|toml|py|rs|go|swift|kt|rb|txt|svg|png|plist|cjs)$/;

// Repo-relative, no leading ./ or trailing /, no blanks or doubles.
export function cleanFiles(files: readonly string[] | undefined): string[] {
  const out = (files ?? []).map((f) => f.trim().replace(/^\.\//, "").replace(/\/+$/, "")).filter(Boolean);
  return [...new Set(out)];
}

// The paths in an entry's text: `lib/app-preview.ts`, `docs/` — a token with a known extension, or a folder.
export function filesInText(text: string): string[] {
  const tokens = [...text.matchAll(/`([^`\s]+)`/g)].map((m) => m[1] ?? "");
  return cleanFiles(tokens.filter((t) => !/^[/~]|:\/\//.test(t) && (EXTENSIONS.test(t) || (t.endsWith("/") && t.length > 1))));
}

export const filesOf = (entry: { files?: string[]; text: string }): string[] =>
  entry.files?.length ? entry.files : filesInText(entry.text);

// A commit's path is one of the entry's: the same file, inside a folder it names, or (for a card in a subfolder, or a
// bare file name) ending with it.
const covers = (file: string, changed: string) => changed === file || changed.startsWith(`${file}/`) || changed.endsWith(`/${file}`);

// Does a commit that changed `changed` carry this entry? One with no files known stamps on any commit, as it always did.
export function carries(entry: { files?: string[]; text: string }, changed: readonly string[]): boolean {
  const files = filesOf(entry);
  return !files.length || files.some((f) => changed.some((c) => covers(f, c)));
}
