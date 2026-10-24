import { randomUUID } from "node:crypto";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { describeBoardTool } from "./board-tools";
import { editPreview } from "./edit-preview";
import { shortToolName, summarizeInput } from "./format";
import { isPlanTool, writePlanPreview } from "./plan-preview";
import { startWaiting, watchHolds } from "./permission-wait";
import { writeQuestionPreview } from "./question-preview";
import { suggestReadScope } from "./read-scope";
import { safeUpdate, sessions, type Pending, type Session } from "./runner-state";
import { pendingView } from "./runner-pending";
import { appendThread } from "./store";
import { readQuestions } from "./turn";
import { MODE_OPTIONS, type PendingElicitation, type PermissionMode, type PromptReason } from "./types";

// A thread's permission requests and questions: asked on the card, answered from the board.
// Answering a request lives in lib/runner-pending.ts, which lib/permission-wait.ts shares.
export { answerPermission, settle } from "./runner-pending";

export function askUser(
  cardId: string,
  session: Session,
  toolName: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
  title?: string,
  // From the claim guard: the symbols the edit touches, for its preview, and why it asked.
  // From the folder guard: the folder outside the project the call reaches, for the buttons that grant it.
  // From an MCP server (lib/elicitation.ts): what it asks, which the card shows as its form instead of the input.
  claim: { symbols?: string[]; why?: PromptReason; folder?: { directory: string; token: string }; elicitation?: PendingElicitation } = {},
): Promise<PermissionResult> {
  return new Promise((resolve) => {
    const questions = toolName === "AskUserQuestion" ? readQuestions(input) : undefined;
    const plan = !questions && isPlanTool(toolName);
    const label = pendingLabel({ questions, plan, title, toolName, input });
    const id = randomUUID();
    const index = appendThread(cardId, { kind: "permission", id, toolName, title: label, at: Date.now() });
    // The first question that names a folder outside the project wins; more buttons would be noise.
    const readScope = questions ? questions.map((q) => suggestReadScope(q.question, session.spec.cwd)).find((s) => s !== undefined) : claim.folder;
    // Plans (ExitPlanMode) live in their own page in the browser pane (lib/plan-preview.ts), so a long
    // Markdown plan doesn't get dumped into the inline prompt as raw JSON.
    const previewUrl = questions
      ? questionPreview(cardId, questions)
      : plan
        ? writePlanPreview(cardId, toolName, input)
        : undefined;
    const { elicitation } = claim;
    // A question, a plan or an MCP server's form is no change to preview, and its own reason for asking.
    const ownForm = Boolean(questions || plan || elicitation);
    const edit = ownForm ? undefined : editPreview(toolName, input, session.spec.cwd, claim.symbols);
    const why = ownForm ? undefined : (claim.why ?? modeWhy(session.spec.permissionMode, toolName));
    const p: Pending = { id, index, toolName, title: label, input, questions, readScope, previewUrl, edit, why, elicitation, resolve };
    session.pending.push(p);
    if (session.pending.length === 1) {
      // A symbol clash (lib/claims.ts) waits by itself: the holder is editing the same code, so the
      // card goes to Running and waits instead of parking in Needs you for an answer that is almost
      // always "wait". Go ahead and Deny stay on the card and in the thread. Every other prompt — the
      // card's permission mode, an outside folder, a question — still needs the user, so it parks.
      if (why?.holder) {
        startWaiting(cardId, p);
        watchHolds();
      } else {
        safeUpdate(cardId, { column: "needs_you", pending: pendingView(p), lastLine: label });
      }
    }
    signal.addEventListener(
      "abort",
      () => {
        const at = session.pending.indexOf(p);
        if (at === -1) return;
        session.pending.splice(at, 1);
        resolve({ behavior: "deny", message: "Cancelled." });
        // The card showed this request; show the next one, or the running turn.
        if (at === 0 && session.busy && sessions.get(cardId) === session) {
          const next = session.pending[0];
          safeUpdate(cardId, {
            column: next ? "needs_you" : "running",
            pending: next ? pendingView(next) : null,
            lastLine: next ? next.title : "Working…",
          });
        }
      },
      { once: true },
    );
  });
}

// The options' preview page, if any option has one; a page that can't be written just leaves the previews out.
function questionPreview(cardId: string, questions: NonNullable<Pending["questions"]>) {
  try {
    return writeQuestionPreview(cardId, questions);
  } catch {
    return undefined;
  }
}

// Why a prompt with no claim behind it came up: the card's permission mode asks before this tool.
export function modeWhy(mode: PermissionMode, toolName: string): PromptReason {
  const option = MODE_OPTIONS.find((m) => m.id === mode);
  return { category: "mode", detail: `${option ? option.label : "This card"} asks before ${shortToolName(toolName)}` };
}

// The one-line title the thread shows above the prompt: a question's joined questions, "Plan ready for
// review" for ExitPlanMode, else the call's title, board-tool description or tool+summary.
function pendingLabel({ questions, plan, title, toolName, input }: { questions: Pending["questions"]; plan: boolean; title?: string; toolName: string; input: Record<string, unknown> }): string {
  if (questions) return questions.map((q) => q.question).join(" ");
  if (plan) return "Plan ready for review";
  const summary = summarizeInput(input);
  return title ?? describeBoardTool(toolName, input) ?? (summary ? `${shortToolName(toolName)}: ${summary}` : shortToolName(toolName));
}
