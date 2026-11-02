import { createContext, useContext } from "react";
import type { ThreadItem } from "./types";

// The thread item find has landed on, so whatever folds it opens for as long as it's the current match
// (a tool run, an edited turn, a brief). It folds back when find moves on, which leaves the thread as it was.
// REVEAL_ALL is for what sits inside an open fold: a tool run in an edited turn holds the match somewhere.
export const REVEAL_ALL = "all";
export type FindReveal = ThreadItem | typeof REVEAL_ALL | null;

export const FindRevealContext = createContext<FindReveal>(null);

// Whether the current match is one of these items.
export function useFindReveal(items: readonly ThreadItem[]): boolean {
  const reveal = useContext(FindRevealContext);
  return reveal === REVEAL_ALL || (reveal !== null && items.includes(reveal));
}
