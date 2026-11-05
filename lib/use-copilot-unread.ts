"use client";

import { useEffect, useSyncExternalStore } from "react";
import { copilotReadAt, setCopilotReadAt, subscribeBoardPrefs } from "./board-prefs";
import { hasUnread, lastReplyAt, type LaneState } from "./copilot-lane";
import type { ThreadItem } from "./types";

// Whether the launcher's dot is lit: the copilot said something (a reply, or an idea of its own) you haven't seen.
// Seeing the peek or the chat counts as reading it, so the dot goes out the moment either is on screen.
export function useCopilotUnread(items: ThreadItem[], state: LaneState): boolean {
  const readAt = useSyncExternalStore(subscribeBoardPrefs, copilotReadAt, copilotReadAt);
  const latest = lastReplyAt(items);
  useEffect(() => {
    if (state !== "hidden" && latest > readAt) setCopilotReadAt(latest);
  }, [state, latest, readAt]);
  return state === "hidden" && hasUnread(items, readAt);
}
