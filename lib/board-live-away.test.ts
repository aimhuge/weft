// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

// Away open's wiring into the live updates: every move reaches it, with whether it chimed (lib/away-open.ts).
const mocks = vi.hoisted(() => ({ effects: vi.fn() }));
vi.mock("./board-view", () => ({ cardChangeEffects: mocks.effects }));
vi.mock("./board-helpers", async (orig) => ({ ...(await orig<typeof import("./board-helpers")>()), announce: vi.fn() }));
vi.mock("./chimes", () => ({ playChime: vi.fn() }));

import { arrive, awayStack, setAwayOpener } from "./away-open";
import { onBoardEvent, type BoardLive } from "./board-live";

function live() {
  return {
    columns: { current: new Map() },
    errors: { current: new Map() },
    ownMoves: { current: new Map() },
    selectedRef: { current: null },
    setCards: vi.fn(),
    setSelectedId: vi.fn(),
    setUnseen: vi.fn(),
    resolveFolders: vi.fn(),
    awayMove: vi.fn(),
  } as unknown as BoardLive;
}

const card = { id: "a", title: "A", column: "needs_you", cwd: "/r" } as Card;

describe("away open in the live updates", () => {
  it("tells away open about a heard move, and an own move as unheard", () => {
    const l = live();
    mocks.effects.mockReturnValue({ moved: true, chime: "needs_you", markUnseen: false, errorChime: false });
    onBoardEvent({ type: "card", card }, l);
    expect(l.awayMove).toHaveBeenCalledWith("a", "needs_you", true);
    mocks.effects.mockReturnValue({ moved: true, chime: null, markUnseen: false, errorChime: false });
    onBoardEvent({ type: "card", card }, l);
    expect(l.awayMove).toHaveBeenLastCalledWith("a", "needs_you", false);
  });

  it("stays out of it when the card didn't move", () => {
    const l = live();
    mocks.effects.mockReturnValue({ moved: false, chime: null, markUnseen: false, errorChime: false });
    onBoardEvent({ type: "card", card }, l);
    expect(l.awayMove).not.toHaveBeenCalled();
  });

  it("drops a deleted card from the stack", () => {
    const l = live();
    setAwayOpener(vi.fn());
    const prefs = { on: true, minutes: 1 };
    arrive({ id: "a", selected: null, busy: false, idleMs: 120_000, prefs });
    arrive({ id: "b", selected: "a", busy: false, idleMs: 120_000, prefs });
    onBoardEvent({ type: "card_deleted", id: "b" }, l);
    expect(awayStack()).toEqual(["a"]);
    setAwayOpener(null);
  });
});
