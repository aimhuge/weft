# Agents

An agent is who a thread is: its **soul**, the first part of the system prompt Weft gives the CLI, and the **skills** it
turns off. **Builder** is the soul every thread had before agents, Weft's own (read SOUL.md, AGENTS.md and the project's
CLAUDE.md). **Copywriter** writes in Weft's voice: the home page, feature intros and voiceovers, the welcome tour,
changelog entries, posts, UI copy. You make more in **Settings → Agents**, and every agent there, built-ins too, can be
edited. An agent changes who the thread is, not what it can do: each keeps the browser pane, the vault, the board tools,
the review tour and the rest of the prompt.

The copilot has personas instead (docs/architecture/copilot-personas.md); a card's agent never reaches it, and the copilot
always starts with Builder's shipped soul.

## Key files

- `lib/agents-built-in.json`: the built-ins as they ship (id, name, emoji, tagline, soul). The same file on GitHub
  (`raw.githubusercontent.com/aimhuge/weft/main/lib/agents-built-in.json`) is what **Reset** pulls.
- `lib/agents.ts` (shared with the board, no storage): `AgentInfo`, `BUILT_IN_AGENTS`, `shippedAgent`, `mergeAgents` (what
  you saved over the built-ins, marked `changed: "you"` or `"github"`, then yours), `findAgent`, `isAgent`, `agentOf`
  (Builder for none, unknown or deleted), `storedAgent` (Builder and unknown store nothing), `AGENT_SOULS` (the shipped souls,
  for the build fingerprint), `WEFT_SOUL_PROMPT`, `COPYWRITER_SOUL_PROMPT`.
- `lib/agent-store.ts` (server): `~/.weft/agents.json` `{ agents, projects }`. `listAgents`, `createAgent`, `updateAgent` (a
  built-in's edit is saved over it; the skills stay unless the edit names them), `deleteAgent` (yours only; its cards and
  project defaults go back to Builder), `resetAgent` (GitHub's text, or the shipped one when GitHub can't be reached or has
  the same; the skills you picked stay), `projectAgent` / `setProjectAgent`, `agentSkillsOff` / `setAgentSkill`,
  `savedAgentsHash`.
- `app/api/agents/route.ts` (GET `{ agents, projects }`, POST a new one, PUT `{ cwd, agent }` a project's default),
  `app/api/agents/[id]/route.ts` (PATCH, DELETE), `app/api/agents/[id]/reset/route.ts` (POST). Every write needs Weft's own
  window (`elevated`): a soul is a system prompt, so a thread's curl can't write one.
- `lib/types-card-detail.ts`: `Card.agent`, absent for Builder. `lib/cron-types.ts`: `Cron.agent`, copied from the source card.
- `lib/runner-state.ts` `specFor`: `Spec.agent` for every card but the copilot. `lib/goose-runner.ts` `planFor` passes it on.
- `lib/weft-prompts.ts` `weftSystemPrompt`: the soul is `agentOf(spec.agent, listAgents()).soul`; `promptsBuild` includes
  `savedAgentsHash()`, so any edit in Settings → Agents replaces idle CLIs on the old text.
- `lib/skill-sets.ts` `baseOff` / `offFor`: a thread's skills are its project's off-list plus its agent's, plus the card's own
  changes. `lib/skill-set-actions.ts` `agentSkillView` and `/api/skills/set?agent=` (PUT `{ agent, name, on }`) back the
  editor's skill list: Weft's, yours and your plugins (a project's own skills follow the project's set).
- `lib/runner-session.ts` `adoptSpare`: a card with an agent never takes a spare, whose CLI started with Builder's soul.
- Making a card: `lib/new-card.ts` (`POST /api/cards`) and `lib/board-tools.ts` `createBoardCard` (both `create_card` tools;
  their `agent` param lists every agent by id) take the agent named, else the project's default. `lib/cron-run.ts` gives
  each run the cron's.
- Switching: `PATCH /api/cards/:id { agent }` → `api.setAgent`.
- Board: `lib/use-agents.ts` (one list per window, shipped until the server answers or where there's none, like weft.zip);
  `components/NewCardDialogControls.tsx` `AgentSelect` (starts on the folder's default, follows a new folder, always sends
  the agent so Builder picked wins over a default; its last row, **Manage agents…**, opens Settings → Agents through
  `BoardFrame`), `lib/card-menu.ts` `agentItems` (right-click → **Agent: …**, Shift+W Builder, W Copywriter, ⌥1–⌥9 yours),
  `components/CardFooterMeta.tsx` `AgentMark` (the emoji, none for Builder or a deleted agent).
- Settings: `components/SettingsAgentsPage.tsx` (the list with Edit, Duplicate, Reset or Delete; each project's default) and
  `components/AgentEditor.tsx` (emoji, name, one line, soul, skills). Saves as you go, like Shortcuts.

## Data flow

Pick ✍️ Copywriter in the New thread dialog → `POST /api/cards { agent }` → `storedAgent` → `card.agent` → `specFor` →
`Spec.agent` → `weftSystemPrompt` opens with its soul, `offFor` adds its skills off → a CLI of its own (no spare).

Edit an agent in Settings → `PATCH /api/agents/:id` → `agents.json` → `savedAgentsHash` changes → idle CLIs are stale and
start again on the new text; `refreshAgents()` updates every picker in the window.

Switch on a card → `PATCH { agent }` → refused mid-turn, a no-op for the agent it has → `updateCard(agent)` → `endSession`
ends the CLI, keeping `sessionId` → the next message opens a new CLI that resumes the same conversation under the new soul.

## Patterns

- The CLI reads its system prompt only when it starts, which is why a switch ends the CLI and a card with an agent skips
  the spares. Unlike a copilot persona switch, the conversation stays: a card's session resumes, the copilot's restarts.
- Puku gets the soul in its first message like the rest of the prompt (`lib/puku-context.ts`); Codex and Goose read it each turn.
- To change a built-in for everyone, edit `lib/agents-built-in.json`; once it's on `main`, Reset brings it to anyone who
  edited theirs, and everyone else gets it with the next update.
- The copywriter's soul is the style guide: Weft as the subject, "your AI", "so" clauses with the payoff, reassurance where
  trust matters, names in full, no plumbing in marketing copy, no hype words, commit/push/deploy (never "save"), and the
  forms for changelog entries, intros and UI copy. The user's own copy-edits win over it.
- Still open: sharing agents with a team (its own card), and agents for the copilot to pick per card it starts.
