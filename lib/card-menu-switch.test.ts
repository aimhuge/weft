// The menu's "Run on <CLI>" keys are derived from the position of the CLI in BACKENDS, so a CLI
// added there always gets one. There are four CLIs today, and the list of modifiers runs out at
// four, so a fifth CLI has to fall back to Ctrl+Shift+J. This file mocks BACKENDS with a fifth
// CLI to reach that fallback; the menu's own tests cover the four real ones.
import { describe, expect, it, vi } from "vitest";
import type { Backend } from "./types";

vi.mock("./new-thread", () => ({
  BACKENDS: [
    { id: "claude", label: "Claude Code" },
    { id: "puku", label: "puku-cli" },
    { id: "codex", label: "Codex" },
    { id: "goose", label: "Goose" },
    { id: "aider", label: "Aider" },
  ] as { id: Backend; label: string }[],
}));

const { cardMenu } = await import("./card-menu");
type Card = import("./types").Card;

const card = (over: Partial<Card> = {}): Card =>
  ({ id: "c1", title: "T", prompt: "p", cwd: "/w", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, ...over });

// Menu items come in several shapes (separators have no id); the switch items carry an id and an accelerator.
const item = (items: readonly unknown[], id: string) => (items as { id?: string; accelerator?: string }[]).find((i) => i.id === id);

describe("the switch key of a fifth CLI", () => {
  it("falls back to Ctrl+Shift+J when the modifier list runs out", () => {
    const menu = cardMenu(card());
    // The card runs on Claude, so the menu offers the other four CLIs. The key comes from the
    // CLI's place in BACKENDS: puku is the second (Shift+J), codex the third (Alt+J), goose the
    // fourth (Ctrl+J) and aider the fifth, which has no modifier left, so it takes the fallback.
    expect(item(menu, "switch:puku")?.accelerator).toBe("Shift+J");
    expect(item(menu, "switch:codex")?.accelerator).toBe("Alt+J");
    expect(item(menu, "switch:goose")?.accelerator).toBe("Ctrl+J");
    expect(item(menu, "switch:aider")?.accelerator).toBe("Ctrl+Shift+J");
  });
});
