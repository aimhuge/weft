// A pending permission request, question or MCP form as every board shows it (the app's lib/types-card.ts re-exports
// these), and the view of one the runner holds.
import type { EditPreview } from "./edit-preview";
import type { PendingElicitation, Question } from "./thread-items";

export interface PendingPermission {
  id: string;
  toolName: string;
  title: string;
  input: Record<string, unknown>;
  // Set when the agent asked questions instead of asking to use a tool.
  questions?: Question[];
  // A folder outside the card's project that a question names, found on the server (the app's lib/read-scope.ts
  // stats the disk, so the client can't run it); the form offers "Read from <token>" for it.
  readScope?: { directory: string; token: string };
  // The page with the options' previews (the app's lib/question-preview.ts); open it at #<question>-<option>.
  previewUrl?: string;
  // What a held Edit/Write would change, readable (the app's lib/edit-preview.ts).
  edit?: EditPreview;
  // Why the prompt came up: a symbol-claim clash (the app's lib/claims.ts clashWhy) or the card's permission mode.
  why?: PromptReason;
  // The user chose Wait: Weft answers it once the holder lets go of the code.
  waiting?: boolean;
  // Set when an MCP server asked instead of a tool (the app's lib/elicitation.ts): Accept / Decline and its form.
  elicitation?: PendingElicitation;
  // The SQL a database-writing call runs (the app's lib/db-calls.ts), with a second model's review once it lands.
  sql?: PendingSql;
}

// A database call's SQL as the prompt shows it (components/SqlReview.tsx): the statements the static scan marks
// (the app's lib/sql-scan.ts) and the review (lib/sql-review.ts), absent while it is still being written.
export interface PendingSql {
  server: string;
  tool: string;
  sql: string;
  // apply_migration's name, or the .sql file a Bash command runs.
  name?: string;
  // 0-based lines inside a statement that drops, deletes or changes access.
  flagged: number[];
  // What it loses, from the static scan: "deletes every row in team_members, overwrites profiles.github_login".
  loses?: string;
  review?: SqlReview;
  // Set when Settings → Security → "Accept harmless SQL" let it through without asking.
  autoAccepted?: true;
}

// safe: nothing is lost and no access changes; access: policies, grants or RLS change; deletes: rows, columns or
// tables go; unknown: the reviewer couldn't tell, or failed (error says why).
export type SqlVerdict = "safe" | "access" | "deletes" | "unknown";

export interface SqlReview {
  verdict: SqlVerdict;
  // One line: what the SQL does overall.
  summary: string;
  // Each destructive statement, shortened, and what it actually does in plain words.
  statements: { sql: string; does: string }[];
  // What data is lost and whether it can be got back; absent when nothing is.
  loss?: string;
  // Anything that looks wrong: a DROP with no matching CREATE, a DELETE without WHERE, a type change on a full column.
  concerns: string[];
  model: string;
  error?: string;
}

// A permission prompt's reason, as a category chip and a short detail (the app's components/PermissionInput.tsx).
// same-code / overlap / whole-file: another busy card's claim (lib/claims.ts); mode: the card's permission mode;
// outside: a folder beyond the card's project (lib/folder-guard.ts); classifier: auto mode's classifier denied
// the call itself, and the prompt offers a one-time retry (lib/classifier-denial.ts).
export interface PromptReason {
  category: "same-code" | "overlap" | "whole-file" | "mode" | "outside" | "classifier";
  detail: string;
  // For a clash: the card holding the claim and its claim key, so Wait can watch for its release (lib/permission-wait.ts).
  // Its emoji and thumbnail show beside the prompt; first: the user put it first, so this card yields (lib/precedence.ts).
  holder?: { id: string; title: string; claim: string; emoji?: string; thumb?: string; first?: true };
  // For an outside-folder Bash call: the word that read as a path, with a little of the line around it (lib/folder-guard.ts).
  match?: { before: string; token: string; after: string };
}

// The board's view of a request the runner holds: its fields, without the runner's own (its thread index, its resolver).
export function pendingView(p: PendingPermission) {
  return { id: p.id, toolName: p.toolName, title: p.title, input: p.input, questions: p.questions, readScope: p.readScope, previewUrl: p.previewUrl, edit: p.edit, why: p.why, waiting: p.waiting, elicitation: p.elicitation, sql: p.sql };
}
