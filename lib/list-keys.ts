// The board's list view's keyboard on @aimhuge/sheet's keyboard rules: start typing and it searches titles; Space
// then B puts the cursor in the Backlog's quick add and Space then R in Running's. The board's own single-letter
// shortcuts (n, b, t, c…) step aside for the search in the list and come back behind Space: after Space, any other key
// goes on to them. j and k still move through the cards, and ? and / keep their meaning.
import { sheetKey, type SheetKeyEvent } from "@aimhuge/sheet";

export { LEADER_MS } from "@aimhuge/sheet";
export type ListKeyEvent = SheetKeyEvent;

export type ListKeyAction =
  | { kind: "pass" }
  | { kind: "leader" }
  | { kind: "add"; column: "backlog" | "running" }
  | { kind: "search"; text: string };

export const LIST_KEYS = {
  leaders: { b: "backlog", r: "running" },
  kept: ["j", "k", "?", "/"],
} as const satisfies { leaders: Record<string, "backlog" | "running">; kept: readonly string[] };

export function listKey(e: ListKeyEvent, leader: boolean): ListKeyAction {
  const action = sheetKey(e, leader, LIST_KEYS);
  return action.kind === "lead" ? { kind: "add", column: action.to } : action;
}
