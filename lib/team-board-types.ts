// What /api/team-board answers (lib/team-board.ts): your teammates' cards for the projects you've checked out here,
// each filed under your own folder for its repo and marked with whose it is (Card.team). Client-safe.
import type { Card, TeamMark } from "./types";

export interface TeamBoard {
  signedIn: boolean;
  cards: Card[];
  // The newest row's updated_at: the next read asks only for what changed after it.
  asOf?: string;
  // Only the cards changed since `asOf`, laid over the last read; `removed` are the ones gone since.
  delta?: boolean;
  removed?: string[];
}

export const EMPTY_TEAM_BOARD: TeamBoard = { signedIn: false, cards: [] };

// "Zulker's Mac": the tile's label for where a teammate's card runs, from their first name.
export function teamMacLabel(mark: Pick<TeamMark, "name">): string {
  const first = mark.name.trim().split(/\s+/)[0] || "A teammate";
  return `${first}'s Mac`;
}

// A changed-cards read laid over the last one: newer rows replace theirs, removed ones go. A whole read stands alone.
export function mergeTeamBoard(prev: TeamBoard, next: TeamBoard): TeamBoard {
  if (!next.delta) return next;
  const gone = new Set([...(next.removed ?? []), ...next.cards.map((c) => c.id)]);
  return { ...next, cards: [...prev.cards.filter((c) => !gone.has(c.id)), ...next.cards], asOf: next.asOf ?? prev.asOf };
}
