// Sort options shared by ProjectBar (desktop and web): the chip bar uses them in
// its select, and the command palette lists them as actions. Two, so the select stays narrow: oldest-first
// went (a saved "oldest" falls back to newest, lib/use-board-view.ts).
import type { SortKey } from "@/lib/board-view";

export const SORTS: { id: SortKey; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "active", label: "Active" },
];
