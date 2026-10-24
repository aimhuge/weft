import { execFileSync } from "node:child_process";
import path from "node:path";
import { SHOW_DIR } from "./show-dir";
import type { Card } from "./types";

// The uncommitted pile: everything in a project's working tree that differs from HEAD. Review cards
// stack up with working code nobody committed, so several cards' edits end up mixed in one tree.
// The header counter (components/PileBadge.tsx) shows its size; clicking it starts a card with
// pilePrompt, which walks the user through committing the pile one card at a time.

export interface PileFile {
  // Relative to the repo root, as git prints it.
  path: string;
  // The two-letter porcelain code: " M", "A ", "??", "D ", "R ".
  code: string;
}

export interface Pile {
  root: string;
  files: PileFile[];
  added: number;
  removed: number;
}

export interface CardPile {
  card: Card;
  files: PileFile[];
}

export interface PileMap {
  // Review cards in the order given, each with the uncommitted files only it touched.
  cards: CardPile[];
  // Files more than one Review card touched.
  shared: { file: PileFile; cards: Card[] }[];
  // Files only cards still at work (not in Review) touched: theirs to commit, not this walk-through's.
  busy: { file: PileFile; cards: Card[] }[];
  // Files no open card touched.
  unclaimed: PileFile[];
}

// `git status --porcelain -z`: "XY path\0", with a rename's original path as the next entry.
export function parseStatus(out: string): PileFile[] {
  const parts = out.split("\0");
  const files: PileFile[] = [];
  let skip = false;
  for (const entry of parts) {
    // The entry after a rename or copy is its original path, not a file of its own.
    if (skip || entry.length < 4) {
      skip = false;
      continue;
    }
    const code = entry.slice(0, 2);
    files.push({ path: entry.slice(3), code });
    skip = code.startsWith("R") || code.startsWith("C");
  }
  return files;
}

// Lines added and removed in `git diff HEAD --numstat`; binary files ("-") count as nothing.
export function parseNumstat(out: string) {
  let added = 0;
  let removed = 0;
  for (const line of out.split("\n")) {
    const [a, r] = line.split("\t");
    added += Number(a) || 0;
    removed += Number(r) || 0;
  }
  return { added, removed };
}

// Whether a card works in this repo: its folder is the root or inside it.
export function inRepo(cwd: string, root: string) {
  return cwd === root || cwd.startsWith(root.endsWith("/") ? root : `${root}/`);
}

// The open cards in this repo: the board's own, not archived and not the copilot.
export function repoCards(cards: Card[], root: string) {
  return cards.filter((c) => !c.archived && c.role !== "copilot" && c.column !== "done" && inRepo(c.cwd, root));
}

// A card's touched files (absolute, see lib/overlap.ts) as repo-relative paths, dropping ones outside it.
function relTouched(card: Card, root: string) {
  const rel = (card.touchedFiles ?? []).map((p) => path.relative(root, p));
  return new Set(rel.filter((p) => p && !p.startsWith("..") && !path.isAbsolute(p)));
}

// Hands each uncommitted file to the cards that touched it: Review cards get their own files, files
// several Review cards touched are flagged as shared, and the rest go to busy cards or nobody.
export function mapPile(files: PileFile[], cards: Card[], root: string): PileMap {
  const touched = cards.map((card) => ({ card, touched: relTouched(card, root), files: [] as PileFile[] }));
  const review = touched.filter((t) => t.card.column === "review");
  const others = touched.filter((t) => t.card.column !== "review");
  // Each entry shares its files array with `review`, so a file pushed there shows up here.
  const map: PileMap = { cards: review.map(({ card, files }) => ({ card, files })), shared: [], busy: [], unclaimed: [] };
  for (const file of files) {
    const owners = review.filter((t) => t.touched.has(file.path));
    const [only] = owners;
    if (only && owners.length === 1) {
      only.files.push(file);
    } else if (owners.length > 1) {
      map.shared.push({ file, cards: owners.map((t) => t.card) });
    } else {
      const busy = others.filter((t) => t.touched.has(file.path));
      if (busy.length) map.busy.push({ file, cards: busy.map((t) => t.card) });
      else map.unclaimed.push(file);
    }
  }
  return map;
}

const CODES: Record<string, string> = { M: "modified", A: "added", D: "deleted", R: "renamed", C: "copied", "?": "new" };

// "modified", "new", "deleted"… from the porcelain code: the staged letter, else the unstaged one.
export function describeCode(code: string) {
  const letter = code.startsWith(" ") ? code.charAt(1) : code.charAt(0);
  return CODES[letter] ?? "changed";
}

function fileLine(f: PileFile) {
  return `${f.path} (${describeCode(f.code)})`;
}

function names(cards: Card[]) {
  return cards.map((c) => `"${c.title}" (${c.id}, ${c.column})`).join(", ");
}

// What the card looks like on the board and what its review tour says to try, so the page can show
// each change as a picture and plain words instead of a file list. Thumbnails are board URLs (/api/…).
function cardLooks(card: Card, origin: string) {
  const lines: string[] = [];
  if (card.thumb) lines.push(`   picture: ${card.thumb.startsWith("/") ? origin + card.thumb : card.thumb}`);
  if (card.emoji) lines.push(`   emoji: ${card.emoji}`);
  for (const step of card.review?.steps ?? []) lines.push(`   try: ${step.title}${step.look ? `: ${step.look}` : ""}`);
  return lines;
}

function statusLine(card: Card) {
  const parts = [card.stage && `stage ${card.stage}`, card.remaining && `remaining: ${card.remaining}`].filter(Boolean);
  return parts.length ? parts.join("; ") : "no status line yet";
}

export interface PilePromptInput {
  pile: Pile;
  map: PileMap;
  // /weft:done's commit.sh, which stages and commits only the paths it is given.
  commitScript: string;
  // The board's own server, so the thread can move a card to Done when the user says so.
  origin: string;
}

// The first message of the commit walk-through card.
export function pilePrompt({ pile, map, commitScript, origin }: PilePromptInput) {
  const name = path.basename(pile.root);
  const out: string[] = [
    `Walk me through committing the uncommitted work in ${pile.root}: ${pile.files.length} files, +${pile.added}/-${pile.removed} lines. Several cards' changes are mixed in this working tree. Commit them one card at a time, each with only its own files.`,
    "",
    "Safety, no exceptions: never `git stash`, `git reset`, `git checkout -- <file>`, `git restore`, `git add -A`, `git add .` or a bare `git commit`. Other threads may be editing this tree right now. Commit only by path, with:",
    `  bash ${commitScript} "<type(scope): message>" <file> <file> …`,
    "(it stages and commits exactly those paths). Use conventional commit messages.",
    "",
  ];

  const withFiles = map.cards.filter((c) => c.files.length);
  const empty = map.cards.filter((c) => !c.files.length);
  if (withFiles.length) {
    out.push(`Cards in Review and the uncommitted files only they touched (from each card's touchedFiles):`);
    withFiles.forEach(({ card, files }, i) => {
      out.push(`${i + 1}. "${card.title}" (card ${card.id}): ${statusLine(card)}`);
      out.push(...cardLooks(card, origin));
      for (const f of files) out.push(`   - ${fileLine(f)}`);
    });
  } else {
    out.push("No card in Review claims any of the uncommitted files.");
  }
  if (empty.length) out.push(`Review cards with nothing uncommitted (maybe already committed): ${names(empty.map((c) => c.card))}.`);
  if (map.shared.length) {
    out.push("", "Shared: more than one Review card touched these. Show me each card's part of the diff and ask which commit takes the file:");
    for (const s of map.shared) out.push(`- ${fileLine(s.file)}: ${names(s.cards)}`);
  }
  if (map.busy.length) {
    out.push("", "Touched only by cards still at work (not in Review). Leave these alone unless I say otherwise:");
    for (const b of map.busy) out.push(`- ${fileLine(b.file)}: ${names(b.cards)}`);
  }
  if (map.unclaimed.length) {
    out.push("", "No open card claims these. Ask me for each: commit with a card, commit on its own, or leave it:");
    for (const f of map.unclaimed) out.push(`- ${fileLine(f)}`);
  }

  out.push(
    "",
    "How to go:",
    "1. Run `git status --porcelain` first: the tree may have moved since this list was made. Fold in what changed.",
    `2. Write a checklist page at ${SHOW_DIR}/commit-${name}/index.html, for someone who doesn't read code. Open it with mcp__browser__open_url and rewrite it after every step, so the pane always shows where we are.`,
    "   - At the top: a big progress line in plain words (\"2 of 7 committed\") and what happens next, one sentence.",
    "   - One visual card per change, no card ids, short enough to take in at a glance: its picture (the `picture:` URL above; else its emoji on a big colored tile), its title as a headline, ONE plain sentence (under 25 words) on what it changes for the person using the app (no file names, no jargon), and at most two \"Try it\" bullets of under 15 words each, from its `try:` steps.",
    "   - Checks as three small badges: Style, Types, Tests, each ✓, ✗ (with a few plain words why) or … waiting. A \"Committed\" stamp once committed (\"Pushed\" once pushed).",
    "   - Under each card, a review bar so I can act right there instead of typing in the thread. Its buttons are links Weft runs itself (they only work from a local page in this card's own pane):",
    "     - \"Commit\", \"Commit and push\" and \"Commit and run /done\" run with no turn: link each to `weft://commit?change=<n>&label=<url-encoded title>&message=<url-encoded commit message>&path=<file>&path=<file>…`, adding `&push=1` to push after the commit and `&done=<that card's id>` to move it to Done after (its Done automations run /weft:done). Put the proposed message and the exact path list on the buttons as soon as you have them; until then show the buttons disabled with \"Checking…\". Weft commits exactly those paths with the script above, pushes, moves the card, adds a Commit item to this thread, and tells the page with a `weft-commit` event on window: `detail` is `{ change, ok, hash, pushed, done, failed, error }`. Add a small script that listens for it and, for that change, stamps \"Committed <hash>\" (\"Pushed\", \"Done\") or shows the error in plain words, so the page is current without a turn. On a failure I get your help in this thread: fix it and rewrite the page.",
    "     - \"Skip for now\" and a one-line text box with Send for \"Tell me what to change\" are `weft://reply?text=<url-encoded message>` links: Weft sends that text to this thread as my reply. Name the change, like `Change 3 (\"Tooltips slide under the pane\"): skip it for now.` (On submit, set location.href to the weft://reply link with the typed words.)",
    "     - After any click, grey out that bar and show \"Working on it…\" until the event arrives or you rewrite the page.",
    "   - Tuck the engineering detail into a closed <details> \"Technical details\" per card: files, diff stats, commit message, commit hash.",
    "   - Shared, busy and unclaimed files go in one short \"Needs a decision\" section at the end, each with its question in plain words and a review bar of answer buttons (weft://reply links) instead of free text where the choices are known.",
    "3. Then card by card, in the order above: show what changed (`git diff HEAD --stat -- <files>` and a short summary of the diff), run lint, typecheck and tests for that card's files where the project's scripts allow (say when a check can only run on the whole project), and mark the results on the page. A file over a lint size or complexity cap gets a real refactor (name the smell, extract a function or module), never joined lines or deleted comments. Propose a commit message and the exact path list on that card's buttons; the buttons commit, so don't commit it yourself unless I ask in the thread.",
    `4. Button commits show up in this thread as Commit items, and the page already marks them. When I ask in words instead, commit with the script above, run \`git push\` if I asked, and to move a card to Done: \`curl -s -X PATCH ${origin}/api/cards/<card id> -H 'x-weft-token: 1' -H 'content-type: application/json' -d '{"column":"done"}'\` (Done runs that card's own Done automations). Rewrite the page after each.`,
    `5. When every change that can go is committed (the rest skipped, held or answered), push and deploy once: \`bash ${path.join(path.dirname(commitScript), "push.sh")}\`, then \`node ${path.join(path.dirname(commitScript), "deploy.mjs")}\` in the background (it waits for the build). Never \`vercel deploy\` from this shared tree. A rejected push stays local: don't pull, rebase, force or retry; say why. Put the push and the deploy (its url, or why not) at the top of the page.`,
    "6. Finish with what is still uncommitted and why.",
  );
  return out.join("\n");
}

function git(cwd: string, args: string[]) {
  return execFileSync("git", ["-C", cwd, "--no-optional-locks", ...args], { encoding: "utf8", timeout: 5000 });
}

// The top of the git repo holding cwd; throws when cwd isn't in one.
export function repoRoot(cwd: string) {
  return git(cwd, ["rev-parse", "--show-toplevel"]).trim();
}

// The pile for the repo holding cwd, or null when cwd isn't in a git repo or the tree is clean.
export function readPile(cwd: string): Pile | null {
  try {
    const root = repoRoot(cwd);
    const files = parseStatus(git(root, ["status", "--porcelain", "-z", "--untracked-files=all"]));
    if (!files.length) return null;
    // A repo with no commits yet has no HEAD to diff against: count no lines then.
    let lines = { added: 0, removed: 0 };
    try {
      lines = parseNumstat(git(root, ["diff", "HEAD", "--numstat"]));
    } catch {}
    return { root, files, ...lines };
  } catch {
    return null;
  }
}
