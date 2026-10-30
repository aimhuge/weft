import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { messagesForMove } from "./automations";
import { head, stampAfterCommit } from "./changelog-stamp";
import { writeChangelog } from "./changelog-write";
import { releaseClaims } from "./claim-guard";
import { holdBack } from "./commit-held";
import { readPile, repoRoot } from "./commit-pile";
import { archiveWhenIdle, isBusy, queueMessages, sendUserMessage } from "./runner";
import { appendThread, getCard, listCards, updateCard } from "./store";

// The commit walk-through's buttons (lib/commit-pile.ts), run without a turn. A page button links to
// weft://commit?…; electron/main.cjs checks it came from the card's own local page and posts it to
// /api/cards/<walk-through card>/commit, which lands here: commit exactly those paths with
// /weft:done's commit.sh, push if asked, move the change's card to Done if asked. The result goes to
// the thread as a "Commit" item and back to the page as a `weft-commit` event. Only a failure (a
// pre-commit hook that refuses, a push that's rejected) becomes a message, so the thread steps in.

const run = promisify(execFile);

export interface CommitRequest {
  message: string;
  // Repo-relative, as the pile lists them.
  paths: string[];
  push: boolean;
  // The id of the card whose change this is, to move to Done after the commit.
  done?: string;
  // The page's own name for the change ("3"), echoed back so it knows which bar to update.
  change?: string;
  // The change's title, for the thread item and a failure message.
  label?: string;
}

export interface CommitResult {
  ok: boolean;
  change?: string;
  hash?: string;
  pushed?: boolean;
  done?: boolean;
  // The step that failed.
  failed?: "commit" | "push" | "done";
  error?: string;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// A path the commit may take: relative, inside the repo, and plain (no option or pathspec magic).
export function safePath(p: string) {
  if (!p || p === "." || p.includes("\0") || path.isAbsolute(p)) return false;
  if (p.startsWith("-") || p.startsWith(":")) return false;
  return !path.normalize(p).split(path.sep).includes("..");
}

// The body (or link) as a request; throws on anything the walk-through couldn't have meant.
export function parseCommitRequest(body: Record<string, unknown>): CommitRequest {
  const message = text(body.message, 2000);
  if (!message) throw new Error("A commit needs a message.");
  const raw = Array.isArray(body.paths) ? body.paths : [];
  const paths = [...new Set(raw.map((p) => text(p, 1000)))];
  if (!paths.length) throw new Error("A commit needs at least one path.");
  const bad = paths.find((p) => !safePath(p));
  if (bad !== undefined) throw new Error(`Not a path this commit can take: ${bad || "(empty)"}`);
  const yes = (v: unknown) => v === true || v === "1" || v === "true";
  return {
    message,
    paths,
    push: yes(body.push),
    done: text(body.done, 100) || undefined,
    change: text(body.change, 100) || undefined,
    label: text(body.label, 200) || undefined,
  };
}

// Git's own words, trimmed to the end, where the reason is.
function output(err: unknown) {
  const e = err as { stdout?: string; stderr?: string; message?: string };
  const all = [e.stdout, e.stderr].filter(Boolean).join("\n").trim() || e.message || String(err);
  return all.length > 3000 ? `…${all.slice(-3000)}` : all;
}

// A move to Done as the board's own (app/api/cards/[id]/route.ts PATCH): Done's automations, then archive.
// On a card that's mid-turn they wait for the turn to end (the card draws in Done meanwhile, wrappingUp).
export function moveToDone(id: string) {
  const card = getCard(id);
  if (!card) throw new Error("No such card.");
  if (card.role === "copilot") throw new Error("The copilot isn't on the board.");
  if (card.column === "done") return;
  if (!isBusy(id)) updateCard(id, { column: "done" });
  queueMessages(id, messagesForMove(card, "done"));
  archiveWhenIdle(id);
}

async function attempt(cardId: string, req: CommitRequest, script: string): Promise<CommitResult> {
  const card = getCard(cardId);
  if (!card) throw new Error("No such card.");
  const root = repoRoot(card.cwd);
  const result: CommitResult = { ok: false, change: req.change };
  // Only files that are uncommitted right now: a stale page can't commit something it never showed.
  const pile = new Set(readPile(root)?.files.map((f) => f.path));
  const gone = req.paths.filter((p) => !pile.has(p));
  if (gone.length) return { ...result, failed: "commit", error: `Nothing uncommitted at ${gone.join(", ")}.` };
  // The change's own card is the one committing, whichever card's page the button is on.
  const committer = (req.done && getCard(req.done)) || card;
  const held = await holdBack(root, req.paths, committer, listCards());
  try {
    await run("bash", [script, req.message, ...req.paths], { cwd: root, timeout: 300_000, maxBuffer: 8 << 20 });
  } catch (err) {
    return { ...result, failed: "commit", error: output(err) };
  }
  // Those files' changes are in, so no card's claim on them stands (lib/claims.ts).
  releaseClaims(req.paths.map((p) => path.join(root, p)), held.map((p) => path.join(root, p)), committer.id);
  result.hash = (await run("git", ["-C", root, "rev-parse", "--short", "HEAD"])).stdout.trim();
  // The change's card shipped: its changelog drafts are committed now (lib/changelog-stamp.ts).
  stampAfterCommit(req.done, root, head(root));
  // And CHANGELOG.md goes in right after, before the push below (lib/changelog-write.ts).
  await writeChangelog(root, req.label ?? req.message);
  if (req.push) {
    try {
      await run("git", ["-C", root, "push"], { timeout: 120_000 });
      result.pushed = true;
    } catch (err) {
      return { ...result, failed: "push", error: output(err) };
    }
  }
  if (req.done) {
    try {
      moveToDone(req.done);
      result.done = true;
    } catch (err) {
      return { ...result, failed: "done", error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ...result, ok: true };
}

function summary(req: CommitRequest, r: CommitResult) {
  const files = `${req.paths.length} file${req.paths.length === 1 ? "" : "s"}`;
  const parts = [r.hash ? `${r.hash} ${req.message} (${files})` : `${req.message} (${files})`];
  if (r.pushed) parts.push("pushed");
  if (r.done) parts.push("card moved to Done");
  if (r.failed) parts.push(`${r.failed} failed`);
  return parts.join(" · ");
}

// What the thread is told when a button fails, so it can fix it (and only then does a turn run).
export function failureMessage(req: CommitRequest, r: CommitResult) {
  const what = req.label ? `Change${req.change ? ` ${req.change}` : ""} ("${req.label}")` : "A change";
  const step =
    r.failed === "commit"
      ? `couldn't be committed. I clicked a commit button with the message "${req.message}" and paths ${req.paths.join(" ")}`
      : r.failed === "push"
        ? `was committed as ${r.hash}, but \`git push\` failed`
        : `was committed as ${r.hash}${r.pushed ? " and pushed" : ""}, but moving its card to Done failed`;
  return `${what} ${step}:\n\n${r.error}\n\nFind out why, fix it if you can, tell me what you did, and update the page.`;
}

// Commits run one at a time: two clicks in a row would trip over git's index lock.
let chain: Promise<unknown> = Promise.resolve();

export function commitFromPage(cardId: string, req: CommitRequest, script: string): Promise<CommitResult> {
  const next = chain.then(async () => {
    const result = await attempt(cardId, req, script);
    appendThread(cardId, {
      kind: "tool",
      id: `commit-${Date.now()}`,
      name: "Commit",
      summary: summary(req, result),
      action: "Committed from the page",
      result: result.ok ? `git commit -- ${req.paths.join(" ")}` : (result.error ?? "failed"),
      isError: !result.ok,
      at: Date.now(),
    });
    if (!result.ok) sendUserMessage(cardId, failureMessage(req, result));
    return result;
  });
  chain = next.catch(() => {});
  return next;
}
