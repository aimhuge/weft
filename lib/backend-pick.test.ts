import { describe, expect, it } from "vitest";
import { backendPick } from "./backend-pick";
import { MODELS } from "./new-thread";
import type { Card } from "./types";

const card = (over: Partial<Card> = {}): Card => ({
  id: "a", title: "a", prompt: "p", cwd: "/x", backend: "claude", permissionMode: "default",
  column: "review", lastLine: "", createdAt: 0, updatedAt: 0, ...over,
});

describe("backendPick", () => {
  it("draws another model on the same CLI, even mid-turn", () => {
    const model = MODELS.claude[0]!.id;
    expect(backendPick(card({ column: "running" }), "claude", model)).toEqual({ patch: { backend: "claude", model } });
  });

  it("moves to the CLI that serves the model, or the picked CLI's default", () => {
    const model = MODELS.puku[0]!.id;
    expect(backendPick(card(), "claude", model)).toEqual({ patch: { backend: "puku", model } });
    expect(backendPick(card(), "codex", "")).toEqual({ patch: { backend: "codex", model: undefined } });
  });

  it("refuses a CLI switch on a live thread", () => {
    expect(backendPick(card({ column: "running" }), "codex", "")).toEqual({ refused: "Stop the thread before switching its CLI." });
  });

  // A model id no CLI serves (a stale link, a hand-edited card): the pick stays on the CLI
  // the user chose rather than moving to nothing.
  it("keeps the picked CLI when the model belongs to none", () => {
    expect(backendPick(card(), "puku", "not-a-model")).toEqual({ patch: { backend: "puku", model: undefined } });
  });

  it("refuses the CLI switch when the model belongs to none and the thread is live", () => {
    expect(backendPick(card({ column: "running" }), "puku", "not-a-model")).toEqual({
      refused: "Stop the thread before switching its CLI.",
    });
  });
});
