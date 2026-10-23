// Sort options shared by ProjectBar (desktop and web): the chip bar uses them in
// its select, and the command palette lists them as actions.
import type { SortKey } from "@/lib/board-view";

export const SORTS: { id: SortKey; label: string }[] = [
  { id: "newest", label: "Newest first" },
  { id: "active", label: "Recently active" },
  { id: "oldest", label: "Oldest first" },
];
