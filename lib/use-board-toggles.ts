"use client";

// Board panel toggles: the browser pane (open card + browser share a window) and the copilot lane (cycles hidden → peek → open). Browser visibility goes through the desktop
// bridge when present, else the local web fallback state.
import { useCallback } from "react";
import { COPILOT_ID } from "./types";
import { LANE_CYCLE, type LaneState } from "./copilot-lane";
import { setCopilotLaneOpen, setCopilotLanePeek } from "./board-prefs";

export interface BoardToggles {
  // Show / hide the browser pane; nothing happens if a card is open (its browser rides with it).
  toggleBrowser: () => void;
  // Cycle the copilot lane through its three states.
  toggleCopilot: () => void;
  // Move the copilot lane to a specific state (hidden / peek / open). Closes the copilot card if open.
  setCopilotState: (next: "hidden" | "peek" | "open") => void;
}

export interface BoardTogglesDeps {
  selectedRef: React.RefObject<string | null>;
  // Whether the browser pane is currently visible (from the desktop bridge or the fallback state).
  browserVisible: boolean;
  // Web fallback when no desktop bridge is present.
  setWebBrowserOpen: (open: boolean) => void;
  // The current copilot lane state (hidden / peek / open), from lib/copilot-lane.ts.
  laneState: LaneState;
  // Closes the copilot card so the new lane doesn't overlap it.
  select: (id: string | null) => void;
}

export function useBoardToggles({
  selectedRef,
  browserVisible,
  setWebBrowserOpen,
  laneState,
  select,
}: BoardTogglesDeps): BoardToggles {
  const toggleBrowser = useCallback(() => {
    // An open card and its browser are one window: they open and close together.
    if (selectedRef.current) return;
    if (window.weft) window.weft.browser.setVisible(!browserVisible);
    else setWebBrowserOpen(!browserVisible);
  }, [selectedRef, browserVisible, setWebBrowserOpen]);

  const setCopilotState = useCallback(
    (next: "hidden" | "peek" | "open") => {
      if (selectedRef.current === COPILOT_ID) select(null);
      setCopilotLaneOpen(next === "open");
      setCopilotLanePeek(next === "peek");
    },
    [selectedRef, select],
  );

  const toggleCopilot = useCallback(() => {
    setCopilotState(LANE_CYCLE[laneState]);
  }, [setCopilotState, laneState]);

  return { toggleBrowser, toggleCopilot, setCopilotState };
}