// The copilot's fixed starter chips, shown under the board-made ones (components/CopilotEmpty.tsx). The server sends
// them to Haiku too (lib/copilot-suggest.ts), so a board chip that covers one can hide it.
// The copilot is a product partner, not a status feed, so its starters are about direction: what to build, the
// code's health and the users. What needs you or finished is the swim lanes' job.
export const STARTERS = [
  "Help me get started with Weft",
  "What should I build next?",
  "Help me shape an idea into cards",
  "What's worth refactoring?",
  "How many users did I get last week?",
  "How did a feature change user behavior?",
  "What did I ship this week?",
] as const;

export const VISIBLE_CHIPS = 4;

type BoardChip = { text: string; project?: string; covers?: string[] };

// The board chips for the board's selected project (null: all of them), most urgent first, and the starters they make
// redundant. A chip with no project is account-wide and shows everywhere. A reply whose chips carry no covers of their
// own (made before chips had a project) falls back to its whole-board covers.
export function chipsFor<C extends BoardChip>(s: { chips: C[]; covers: string[] }, project: string | null) {
  const chips = s.chips.filter((c) => !project || !c.project || c.project === project).slice(0, VISIBLE_CHIPS);
  const own = s.chips.some((c) => c.covers);
  const covers = own ? chips.flatMap((c) => c.covers ?? []) : chips.length ? s.covers : [];
  return { chips, covers: new Set(covers) };
}
