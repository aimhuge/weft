import type { ThreadItem } from "./types";

// The copilot floats in the window's bottom-right corner (components/CopilotLane.tsx, placed by
// lib/copilot-float.ts). It has three states, like Intercom's messenger:
//
//   hidden  — the round launcher alone (avatar, a dot when the copilot has said something you haven't read). The default.
//   peek    — the copilot's latest reply or idea above the launcher, and an ask box. Reached by resting on the launcher.
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

const STATUS_LINE = /^\s*(BOARD STATUS:|`?=-=\[)/;

// The copilot's answer to a check-in (lib/copilot-initiative.ts) when it had nothing worth showing.
export const isQuiet = (text: string) => /^\s*QUIET\.?\s*$/.test(text.split("\n").filter((l) => !STATUS_LINE.test(l)).join("\n"));

// The copilot's latest reply as one plain line: Markdown marks and status lines (BOARD STATUS, a
// "=-=[ SESSION STATUS" line some CLAUDE.md files ask for) dropped.
export function lastReply(items: ThreadItem[], max = 220): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.kind !== "assistant" || !item.text.trim() || isQuiet(item.text)) continue;
    const text = item.text
      .split("\n")
      .filter((line) => !STATUS_LINE.test(line) && !/^\s*```/.test(line))
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

// When the copilot last said something worth reading: its latest reply with text, or 0 before it said anything.
export function lastReplyAt(items: ThreadItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.kind === "assistant" && item.text.trim() && !isQuiet(item.text)) return item.at;
  }
  return 0;
}

// Whether the launcher's dot is lit: the copilot replied (or brought an idea of its own, lib/copilot-initiative.ts)
// after you last looked. The board's own counts stay in the swim lanes; this dot is only the copilot's news.
export const hasUnread = (items: ThreadItem[], readAt: number) => lastReplyAt(items) > readAt;
