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
});
