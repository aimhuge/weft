import type { Card, ThreadItem } from "./types";

// The copilot floats in the window's bottom-right corner (components/CopilotLane.tsx, placed by
// lib/copilot-float.ts). It has three states, like Intercom's messenger:
//
//   hidden  — the round launcher alone (avatar, news count). The default.
//   peek    — the digest above the launcher: what needs you, what finished since you last asked, the
//             latest reply, and an ask box. Reached by resting on the launcher or the copilot having news.
//   open    — the chat above the launcher. Reached by a click on the launcher, ⌘J, the top bar button,
//             or the peek's maximize button.
export type LaneState = "hidden" | "peek" | "open";

// ⌘J and the top bar button cycle through the three states in this order.
export const LANE_CYCLE: Record<LaneState, LaneState> = { hidden: "peek", peek: "open", open: "hidden" };

// Resolve the current lane state from the two cookies (lib/board-prefs.ts). `open` wins over `peek`.
export function laneStateFromPrefs(open: boolean, peek: boolean): LaneState {
  return open ? "open" : peek ? "peek" : "hidden";
}

// How narrow a board column may get before the board scrolls instead. The copilot takes no width now,
// but while its peek or chat covers the board's right edge the columns narrow so more of them fit.
export function columnMinWidth(state: LaneState): number {
  return state === "open" || state === "peek" ? 120 : 170;
}

export interface LaneDigest {
  // Cards waiting on you, newest first.
  needsYou: Card[];
  // Cards that reached Review or Done since you last asked the copilot something.
  finished: number;
  // The copilot's latest reply, flattened to one line, or null before it said anything.
  lastReply: string | null;
}

// When you last asked the copilot something: the time of the last message you sent it.
export function lastAsked(items: ThreadItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.kind === "user") return item.at;
  }
  return 0;
}

// The copilot's latest reply as one plain line: Markdown marks and status lines (BOARD STATUS, a
// "=-=[ SESSION STATUS" line some CLAUDE.md files ask for) dropped.
export function lastReply(items: ThreadItem[], max = 220): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.kind !== "assistant" || !item.text.trim()) continue;
    const text = item.text
      .split("\n")
      .filter((line) => !/^\s*(BOARD STATUS:|`?=-=\[)/.test(line) && !/^\s*```/.test(line))
      .join(" ")
      .replace(/[*_`#>]+/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  }
  return null;
}

// What the peek shows: what needs you, what finished since you last asked, the latest reply.
export function laneDigest(cards: Card[], items: ThreadItem[]): LaneDigest {
  const since = lastAsked(items);
  const live = cards.filter((c) => !c.archived && c.role !== "copilot");
  return {
    needsYou: live.filter((c) => c.column === "needs_you").sort((a, b) => b.updatedAt - a.updatedAt),
    finished: live.filter((c) => (c.column === "review" || c.column === "done") && c.updatedAt > since).length,
    lastReply: lastReply(items),
  };
}
