// Starting a card to do one thing: the thread that paints a theme, the one a Slack message starts,
// the one a cloud command asks for.
//
// A card-making feature used to know two things it had no business knowing: the shape of a card
// body, and that a card is made in two steps — create it, then start its first turn. This is
// those two steps in one place, so a new feature says what the card is for and leaves the rest
// here.

import type { ThreadAgent } from "./agents";
import { createCardFromBody, startCard } from "./new-card";
import type { Card } from "./types";

// What a card made to do one thing is: a name on the board, what the thread is asked to do, the
// folder it works in, and the CLI it runs on. The rest — its tags, its model, its effort, who it
// is — is optional, and left out the card takes the default (lib/new-card.ts).
//
// The CLI, the effort and the mode are typed as text, not as the enums (Backend, Effort,
// PermissionMode): a card whose body came off the network names them as text, and
// lib/new-card.ts checks them and falls back to the default.
export interface FeatureCard {
  // The card's name on the board. Left out, the prompt names it.
  title?: string;
  // What the thread is asked to do.
  prompt: string;
  // The folder the thread works in.
  cwd: string;
  // The CLI it runs on. Left out, the default one (lib/settings.ts defaultBackend).
  backend?: string;
  // The model it runs on. Left out, the CLI's own choice (lib/new-thread.ts NO_MODEL).
  model?: string;
  // The effort it runs on. Left out, the CLI's own choice.
  effort?: string;
  // The mode it starts in. Left out, the default mode (lib/settings.ts defaultPermissionMode).
  permissionMode?: string;
  // The card's tags; they count as yours (lib/tags.ts).
  tags?: string[];
  // Who the thread is (lib/agents.ts); left out, the project's default agent.
  agent?: ThreadAgent;
  // A git worktree of its own (docs/architecture/worktrees.md); left out, the shared folder.
  isolated?: boolean;
}

// What a caller may hand the helper: the fields above, or a body read off the network whose types
// are not yet known (lib/cloud-commands.ts newCardBody). The card maker checks every field anyway
// (lib/new-card.ts), so what comes in is what comes in.
export type FeatureCardInput = Partial<FeatureCard> & Record<string, unknown>;

// Makes the card and starts its first turn.
//
// `beforeStart` runs in between, for the caller that has to set the card up before its thread
// begins: a Slack card is posted to its channel and saved there first, so a turn that fails at
// once lands in the card's own thread rather than opening a stray one in the drawer's channel.
export async function startFeatureCard(card: FeatureCardInput, beforeStart?: (card: Card) => void | Promise<void>): Promise<Card> {
  const made = createCardFromBody({ ...card });
  if (beforeStart) await beforeStart(made);
  startCard(made);
  return made;
}
