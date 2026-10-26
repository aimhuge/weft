# Agents

An agent is who a thread is: its **soul**, the first part of the system prompt Weft gives the CLI. **Builder** is the soul
every thread had before agents, Weft's own (`WEFT_SOUL_PROMPT`: read SOUL.md, AGENTS.md and the project's CLAUDE.md).
**Copywriter** writes in Weft's voice: the home page, feature intros and voiceovers, the welcome tour, changelog entries,
posts, UI copy. An agent changes who the thread is, not what it can do: both keep the browser pane, the vault, the board
tools, the review tour and the rest of the prompt.

The copilot has personas instead (docs/architecture/copilot-personas.md); a card's agent never reaches it.

## Key files

- `lib/agents.ts`: `AGENTS` (name, emoji, tagline, soul), `AGENT_ORDER`, `isAgent`, `agentOf` (Builder for none or unknown),
  `storedAgent` (Builder and unknown names store nothing, so old and new default cards read the same), `AGENT_SOULS` (every
  soul joined, for the build fingerprint), `WEFT_SOUL_PROMPT` and `COPYWRITER_SOUL_PROMPT`.
- `lib/types-card-detail.ts`: `Card.agent`, absent for Builder. `lib/cron-types.ts`: `Cron.agent`, copied from the source card.
- `lib/runner-state.ts` `specFor`: `Spec.agent` for every card but the copilot. `lib/goose-runner.ts` `planFor` passes it to
  `lib/goose-recipe.ts`.
- `lib/weft-prompts.ts` `weftSystemPrompt`: the soul is `agentOf(spec.agent).soul`; the memo key includes the agent;
  `WEFT_PINNED_PROMPTS.AGENT_SOULS` puts every soul in the prompt fingerprint, so editing one replaces idle CLIs.
- `lib/runner-session.ts` `adoptSpare`: a card with an agent never takes a spare, whose CLI started with Builder's soul.
- Making a card with one: `lib/new-card.ts` (`POST /api/cards`, `body.agent`), `lib/board-tools.ts` `createBoardCard` and
  both `create_card` tools (`agent: "builder" | "copywriter"`), `lib/cron-run.ts` (each run gets the cron's).
- Switching: `PATCH /api/cards/:id { agent }` (`setAgent` in `app/api/cards/[id]/route.ts`) → `api.setAgent`.
- UI: `components/NewCardDialogControls.tsx` `AgentSelect` (the New thread dialog, beside the model menu; every dialog
  starts on Builder, not remembered), `lib/card-menu.ts` `agentItems` (right-click → **Agent: 🛠 Builder** / **Agent: ✍️
  Copywriter**, keys Shift+W / W) run by `components/use-board-menus.ts` `runAgentAction`, and `components/CardFooterMeta.tsx`
  `AgentMark` (the agent's emoji in the card footer, none for Builder).

## Data flow

Pick ✍️ Copywriter in the New thread dialog → `POST /api/cards { agent }` → `storedAgent` → `card.agent` → `specFor` →
`Spec.agent` → `weftSystemPrompt` opens with `COPYWRITER_SOUL_PROMPT` → a CLI of its own (no spare).

Switch on a card → `PATCH { agent }` → refused mid-turn, a no-op for the agent it has → `updateCard(agent)` → `endSession`
ends the CLI, keeping `sessionId` → the next message opens a new CLI that resumes the same conversation under the new soul.

## Patterns

- The CLI reads its system prompt only when it starts, which is why a switch ends the CLI and a card with an agent skips
  the spares. Unlike a copilot persona switch, the conversation stays: a card's session resumes, the copilot's restarts.
- Puku gets the soul in its first message like the rest of the prompt (`lib/puku-context.ts`); Codex and Goose read it each turn.
- The copywriter's soul is the style guide: Weft as the subject, "your AI", "so" clauses with the payoff, reassurance where
  trust matters, names in full, no plumbing in marketing copy, no hype words, commit/push/deploy (never "save"), and the
  forms for changelog entries, intros and UI copy. Change Weft's voice there, and the user's own copy-edits win over it.
- Still open: your own agents (a soul you write), an agent per project, and agents for the copilot to pick per card it starts.
