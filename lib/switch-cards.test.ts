// Switch all over a column with this Mac's cards and a worker's: one bulk route call, one host verb per worker card.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const switchBackends = vi.hoisted(() => vi.fn());
vi.mock("./client", () => ({ api: { switchBackends } }));
const act = vi.hoisted(() => vi.fn());
vi.mock("./project-host", () => ({ hostOf: () => ({ act }) }));

const { switchCards } = await import("./switch-cards");

const card = (id: string, cwd: string, over: Partial<Card> = {}) => ({ id, cwd, column: "needs_you", ...over }) as Card;

beforeEach(() => {
  vi.clearAllMocks();
  switchBackends.mockResolvedValue({ switched: ["a"], failed: [{ id: "b", error: "no" }], pending: ["c"] });
  act.mockResolvedValue(undefined);
});

describe("switchCards", () => {
  it("sends this Mac's cards to the bulk route and a worker's as card.switchBackend, and adds them up", async () => {
    act.mockRejectedValueOnce(new Error("That thread isn't on this worker."));
    const got = await switchCards(
      [card("a", "/r"), card("b", "/r"), card("c", "/r"), card("w1", "worker://w/ling", { rateLimitHit: true }), card("w2", "worker://w/ling"), card("w3", "worker://w/ling"), card("w4", "worker://w/ling", { column: "running" })],
      "codex",
    );
    expect(switchBackends).toHaveBeenCalledWith(["a", "b", "c"], "codex");
    expect(act).toHaveBeenNthCalledWith(1, "card.switchBackend", { id: "w1", backend: "codex", replay: true });
    expect(act).toHaveBeenNthCalledWith(2, "card.switchBackend", { id: "w2", backend: "codex", replay: false });
    expect(act).toHaveBeenCalledTimes(3);
    expect(got.switched).toEqual(["a", "w2", "w3"]);
    expect(got.failed.slice(0, 2)).toEqual([{ id: "b", error: "no" }, { id: "w1", error: "That thread isn't on this worker." }]);
    expect(got.failed[2]?.id).toBe("w4");
    expect(got.failed[2]?.error).toMatch(/still running/);
    expect(got.pending).toEqual(["c"]);
  });

  it("skips the route with no card of this Mac's, and reads a thrown non-error", async () => {
    act.mockRejectedValueOnce("gone");
    expect(await switchCards([card("w1", "worker://w/ling")], "claude")).toEqual({ switched: [], failed: [{ id: "w1", error: "gone" }], pending: [] });
    expect(switchBackends).not.toHaveBeenCalled();
  });
});
