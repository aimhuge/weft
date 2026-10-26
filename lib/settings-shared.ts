// Shared settings bits: the keep-alive minutes shown in the Threads page select, and the styling
// tokens used across the settings cards.
import type { Base } from "./theme";

export const KEEP_ALIVE: { minutes: number; label: string }[] = [
  { minutes: 0, label: "Until the app quits" },
  { minutes: 60, label: "1 hour" },
  { minutes: 240, label: "4 hours" },
  { minutes: 15, label: "15 minutes" },
];

// The caps the Threads page offers on running threads; 0 is no limit. A saved value off this list is added to the menu.
export const MAX_THREADS_CHOICES: number[] = [2, 3, 4, 6, 8, 12, 0];

// A dark wash over a dark scene, a light one over a light scene, so the header and frosted cards read.
export const SCRIM: Record<Base, string> = {
  dark: "linear-gradient(180deg, rgb(0 0 0 / 0.45), rgb(0 0 0 / 0.15) 35%, rgb(0 0 0 / 0.5))",
  light: "linear-gradient(180deg, rgb(255 255 255 / 0.55), rgb(255 255 255 / 0.2) 35%, rgb(255 255 255 / 0.55))",
};

export const SETTINGS_TITLE = "text-[13px] font-medium text-ink";
export const SETTINGS_HINT = "text-[12.5px] text-muted";
