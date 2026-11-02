// Sprint planning for a worker project (docs/architecture/project-hosts.md, T6). On this Mac the prompt is written
// from this Mac's store and tells the card to PATCH this Mac's server (lib/sprint-plan.ts). A worker's card has the
// board's tools instead (mcp__board__list_cards, create_card), so the prompt starts from the Backlog the board holds and
// the worker's snapshot counts, and the sprint's cards are started by the user from the board, which owns their column.
import { clip, timeAgo } from "./format";
import type { BacklogSummary } from "./project-reads";
import type { Card } from "./types";

const line = (prompt: string) => clip(prompt.replace(/\s+/g, " ").trim(), 700);

// The open cards of a worker project: the board's own for that folder, not archived and not the copilot.
export function workerProjectCards(cards: Card[], cwd: string): Card[] {
  return cards.filter((c) => !c.archived && c.role !== "copilot" && c.column !== "done" && (c.cwd === cwd || c.cwd.startsWith(`${cwd}/`)));
}

export function workerSprintPrompt(backlog: BacklogSummary, cards: Card[], cwd: string, now: number): { prompt: string; title: string } {
  const open = workerProjectCards(cards, cwd);
  const waiting = open.filter((c) => c.column === "backlog").sort((a, b) => a.createdAt - b.createdAt);
  const active = open.filter((c) => c.column !== "backlog");
  const n = waiting.length || backlog.count;
  const out: string[] = [
    `Plan the Backlog of ${backlog.root} into sprints: ${n} card${n === 1 ? "" : "s"} wait there. Read each one against the code, then tell me how we'll get through all of them.`,
    "",
    "Rules: this is planning. Don't edit any file in the project, and don't add or change a card until I say so. Every card here runs in the same folder (no worktrees), so two cards that edit the same files must not run at the same time.",
    "",
    "Backlog cards, oldest first:",
  ];
  if (!waiting.length) out.push("(the board's list didn't reach this thread; read them with mcp__board__list_cards, column backlog)");
  waiting.forEach((card, i) => {
    out.push(`${i + 1}. "${card.title}" (card ${card.id}, added ${timeAgo(card.createdAt, now)}${card.tags?.length ? `, tagged ${card.tags.join(", ")}` : ""})`);
    out.push(`   asks: ${line(card.prompt) || "(no prompt)"}`);
  });
  if (active.length) {
    out.push("", "Already at work in this project (plan around their files, and don't start a card that would collide with one):");
    for (const card of active) {
      const status = [card.stage && `stage ${card.stage}`, card.remaining && `remaining: ${card.remaining}`].filter(Boolean).join("; ");
      out.push(`- "${card.title}" (card ${card.id}, ${card.column}${status ? `; ${status}` : ""})`);
    }
  }
  out.push(
    "",
    "How to go:",
    "1. For each Backlog card, find the code it would change (search, read; no edits) and work out: which files and areas it touches; its size (S under an hour of agent work, M a few turns, L a day or more); what it depends on; and whether it's already done (check `git log` and the code), a duplicate of another card, too vague to start, or too big for one card.",
    "2. Group the cards into sprints. A sprint is a set of cards that can run side by side: no two touch the same files, and none collides with a card already at work. Keep a sprint to 3 or 4 cards. Order the sprints by dependency first, then by value to the user, quick wins early. Cards needing a decision wait in \"Needs a decision\".",
    "3. Write the plan as an HTML page for someone who doesn't read code and open it with mcp__browser__open_url, rewriting it after every change: one plain sentence on the whole plan, one column per sprint (each card with its title, ONE plain sentence on what it changes for the user, a size badge S/M/L and an \"after: <card>\" note), engineering detail in a closed <details>, and a \"Needs a decision\" section.",
    "4. Wait for my answers in this thread. Change the plan when I ask.",
    "5. You can't start or archive an existing card from here. When I say start a sprint, list its cards by title and id so I can move them to Running on the board, and don't suggest the next sprint until I ask: its cards may need this one's work committed first.",
    "6. On my OK only: merge or split cards by adding the new ones to Backlog with mcp__board__create_card (start: false, folder this project's), each with a self-contained brief, and tell me which old cards to archive.",
  );
  return { prompt: out.join("\n"), title: `Plan the ${backlog.root} backlog into sprints` };
}
