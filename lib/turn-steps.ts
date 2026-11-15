// Simple mode's "fold tool steps" piece (docs/architecture/simple-mode.md #2): every run of tool calls in one
// agent turn merges into a single line, "Weft ran 14 steps", that opens to show the runs as they were. Prose,
// pictures, questions and the user's messages stay where they are; only the runs fold together.
import { describeToolRun, toolAction } from "./format";
import type { ThreadItem } from "./types";

type ToolCall = Extract<ThreadItem, { kind: "tool" }>;
type Permission = Extract<ThreadItem, { kind: "permission" }>;

// What a thread shows: a message, or a run of tool calls between messages, folded into one line. key is
// the index of the first thread item in it, so it stays put as the run grows (components/ThreadItems.tsx groupThread).
export type ToolsEntry = { kind: "tools"; calls: (ToolCall | Permission)[]; key: number };
export type Entry = { kind: "item"; item: ThreadItem; key: number } | ToolsEntry;
// A turn's runs as one line, keyed by its first run, which is where the line sits.
export type StepsEntry = { kind: "steps"; runs: ToolsEntry[]; key: number };
export type TurnRow = Entry | StepsEntry;

// What ends a turn: your message (or a "!" command, or one you edited), and the marker the turn ended with.
// A turn a background task starts afterwards is a new one.
const TURN_ENDS = new Set<ThreadItem["kind"]>(["user", "shell", "edited", "result"]);

const isTool = (call: ToolCall | Permission): call is ToolCall => call.kind === "tool";

// A run stays out of the fold when it's only permission rows (nothing ran), or when a permission in it
// still waits for you: a prompt you have to answer is never folded away.
function staysOut(run: ToolsEntry) {
  return !run.calls.some(isTool) || run.calls.some((c) => c.kind === "permission" && !c.decision);
}

// The thread's entries with each turn's runs merged into one steps row, placed at the turn's first run.
export function foldTurnSteps(entries: readonly Entry[]): TurnRow[] {
  const rows: TurnRow[] = [];
  let steps: StepsEntry | undefined;
  for (const entry of entries) {
    if (entry.kind === "item") {
      if (TURN_ENDS.has(entry.item.kind)) steps = undefined;
      rows.push(entry);
    } else if (staysOut(entry)) rows.push(entry);
    else if (steps) steps.runs.push(entry);
    else {
      steps = { kind: "steps", runs: [entry], key: entry.key };
      rows.push(steps);
    }
  }
  return rows;
}

export const stepsLabel = (steps: number) => `Weft ran ${steps} ${steps === 1 ? "step" : "steps"}`;

// What the folded line says: the step count (tool calls), how many failed or were denied, the call still
// running while the turn is live, the screenshots its runs took (they stay visible) and the long
// "Ran 3 commands, read 2 files" description for its tooltip.
export function turnSteps(runs: readonly ToolsEntry[], live: boolean) {
  const calls = runs.flatMap((run) => run.calls);
  const tools = calls.filter(isTool);
  // Every kind of call, not the first three: the tooltip has room the line doesn't.
  const { text } = describeToolRun(tools.map((t) => ({ action: t.action ?? toolAction(t.name), target: t.summary })), Infinity);
  return {
    label: stepsLabel(tools.length),
    summary: text,
    failed: tools.filter((t) => t.isError).length,
    denied: calls.filter((c) => c.kind === "permission" && c.decision === "deny").length,
    running: live ? tools.find((t) => t.result === undefined && t.resultBytes === undefined) : undefined,
    images: [...new Set(tools.flatMap((t) => t.images ?? []))],
  };
}
