// The New thread form every client fills in (docs/architecture/new-card-parity.md): the desktop's dialog
// (components/NewCardDialog.tsx), the same dialog on weft.zip over the cloud transport, its phone-width layout
// (components/web-board/PhoneNewCard.tsx) and the phone app (~/dev/weft-mobile NewCard). One type and one field order,
// so the three can't drift apart again: each draws NEW_CARD_FIELDS in this order and sends a NewCardForm.
import type { Backend, Effort } from "./card";
import type { NewCardMode } from "./cloud-commands";

export interface NewCardForm {
  prompt: string;
  // A model id from MODELS ("" or absent: the CLI's own default). It also says which CLI runs the card.
  model?: string;
  effort?: Effort | "";
  // The CLI, when no model names it (the CLI picker's "default model").
  backend?: Backend;
  permissionMode?: NewCardMode;
  tags?: string[];
  // Made in Backlog instead of started.
  backlog?: boolean;
  // A git worktree of its own (docs/architecture/worktrees.md), on `branch` when it names one, else its own weft/* one.
  isolated?: boolean;
  branch?: string;
}

// The pickers under the prompt, in the order every client shows them. The prompt (with its files, voice and @ and /
// typeaheads) comes first and Backlog vs Start last, so neither is listed.
export const NEW_CARD_FIELDS = ["where", "isolate", "agent", "model", "effort", "mode", "tags"] as const;
export type NewCardField = (typeof NEW_CARD_FIELDS)[number];
