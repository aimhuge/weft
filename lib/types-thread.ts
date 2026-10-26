// Thread-item types (what the chat panel shows, and the agent's questions).

import type { EditPreview } from "./edit-preview-types";
import type { SecretAsk } from "./vault-view";

// A question the agent asked with its AskUserQuestion tool.
export interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  // preview: a mockup or code snippet for the option, shown in the browser pane while it's highlighted.
  options: { label: string; description?: string; preview?: string }[];
}

// What goes back with a question's answers: notes on a pick (and the preview it showed), keyed by question,
// or, instead of answers, a message to talk it over ("Chat about this").
export interface QuestionReply {
  annotations?: Record<string, { notes?: string; preview?: string }>;
  chat?: string;
}

// One field of an MCP server's elicitation form (lib/elicitation.ts elicitationFields). Its answer travels as a
// string: "true"/"false" for a boolean, a JSON array of values for a multi-select.
export interface ElicitField {
  name: string;
  title: string;
  description?: string;
  required: boolean;
  kind: "string" | "number" | "integer" | "boolean" | "enum" | "multi";
  options?: { value: string; label: string }[];
  default?: string;
}

// An MCP server asking the user to confirm or fill something in mid-call (components/ElicitationForm.tsx):
// its message, a form when it sent a schema, or a URL to open (mode "url").
export interface PendingElicitation {
  server: string;
  message: string;
  mode?: "url";
  url?: string;
  fields: ElicitField[];
}

export type ThreadItem =
  // id is the uuid Weft sent the prompt to the CLI with, so ↑ can rewind its turn (lib/edit-last.ts).
  // page is what the card's browser pane showed as it was sent (lib/pane-page.ts), for the show rail.
  // midTurn: sent while a turn ran, so the CLI took it in after its next tool call (lib/runner-steer.ts).
  | { kind: "user"; text: string; at: number; id?: string; page?: string; midTurn?: true }
  | { kind: "assistant"; text: string; at: number }
  | {
      kind: "tool";
      id: string;
      name: string;
      summary: string;
      // What the call did, from format.ts toolAction (missing on threads saved before it existed).
      action?: string;
      at: number;
      result?: string;
      // Set when a long result was left out of the item (lib/cloud-sync-types.ts TOOL_RESULT_INLINE_MAX):
      // its length, so the row can say how much it holds before it's fetched.
      resultBytes?: number;
      // URLs of images the tool returned, like a screenshot.
      images?: string[];
      isError?: boolean;
      // The path the tool read or edited, relative to the card folder when inside it. Set by
      // lib/runner-turn.ts at tool_use time so the thread can render a clickable file link.
      file?: string;
      // The diff of an Edit/Write/MultiEdit/NotebookEdit call, computed before the edit runs (so
      // Write's diff is against the file on disk, not the new content). components/EditDiff.tsx
      // renders it inline instead of the raw result.
      edit?: EditPreview;
      // An mcp__secrets__ask_add call: the thread shows an input for this key in its place (lib/vault-view.ts).
      ask?: SecretAsk;
    }
  | {
      kind: "permission";
      id: string;
      toolName: string;
      title: string;
      decision?: "allow" | "deny";
      // The user's answers, when the agent asked questions.
      answer?: string;
      at: number;
    }
  | { kind: "result"; text: string; costUsd?: number; isError: boolean; at: number }
  // A background task the CLI told the agent had ended (its <task-notification>), which can start a turn
  // of its own (lib/runner-tasks.ts).
  | { kind: "notification"; status: "completed" | "failed" | "stopped"; summary: string; at: number }
  // Where a cold card's fresh session begins (lib/splice.ts): the brief it started from and the tokens it didn't re-send.
  | { kind: "spliced"; at: number; brief: string; tokens?: number }
  // A message you edited with ↑, and the turn it started, folded away when the edit went out.
  | { kind: "edited"; items: ThreadItem[]; at: number }
  // A "!" command you ran from the reply box (lib/shell.ts). ms is set once it ends; sent once its
  // output went to Claude with your next message.
  | {
      kind: "shell";
      command: string;
      at: number;
      output?: string;
      exitCode?: number | null;
      ms?: number;
      timedOut?: boolean;
      sent?: boolean;
    };
