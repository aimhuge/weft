// A worker card's right-click menu (lib/card-menu-remote.ts): the card's own menu, trimmed to what a remote host's
// verbs back, with its separators kept tidy.
import { describe, expect, it } from "vitest";
import { cardMenu, type MenuItem } from "./card-menu";
import { remoteMenu } from "./card-menu-remote";
import type { Card } from "./types";

const card = (over: Partial<Card> = {}) => ({ id: "c1", title: "Fix it", cwd: "worker://w1/ling", backend: "claude", permissionMode: "default", column: "review", sessionId: "s1", createdAt: 0, updatedAt: 0, ...over }) as Card;

const ids = (items: MenuItem[]) => items.map((i) => ("id" in i ? i.id : "—"));

describe("remoteMenu", () => {
  it("keeps rename, the moves, the modes a remote host takes, Run on, the marks and archive", () => {
    const kept = ids(remoteMenu(cardMenu(card({ review: { dev: { command: "pnpm dev" } } as never }), null, true)));
    expect(kept).toEqual(expect.arrayContaining(["open", "rename", "move:done", "move:backlog", "mode:default", "mode:acceptEdits", "mode:auto", "new-here", "star", "tags", "archive"]));
    expect(kept.some((id) => id.startsWith("switch:"))).toBe(true);
  });

  it("drops what reads or widens this Mac, or has no verb: skills, dev server, vault, agents, folder, share, delete, skipping prompts", () => {
    const kept = ids(remoteMenu(cardMenu(card({ review: { dev: { command: "pnpm dev" } } as never }), null, true)));
    for (const gone of ["skill:weft:done", "dev:start", "vault:revoke", "mode:bypassPermissions", "reveal", "copy-path", "copy-resume", "share", "delete"]) expect(kept).not.toContain(gone);
    expect(kept.some((id) => id.startsWith("agent:"))).toBe(false);
  });

  it("keeps Stop on a live card and Start on a Backlog one", () => {
    expect(ids(remoteMenu(cardMenu(card({ column: "running" }))))).toContain("stop");
    expect(ids(remoteMenu(cardMenu(card({ column: "backlog" }))))).toContain("start");
  });

  it("never starts, ends or doubles a separator", () => {
    const sep = { type: "separator" } as const;
    const out = remoteMenu([sep, { id: "skill:x", label: "x" }, sep, { id: "open", label: "Open" }, sep, sep, { id: "dev:start", label: "d" }, sep, { id: "star", label: "Star" }, sep, { id: "delete", label: "D" }]);
    expect(ids(out)).toEqual(["open", "—", "star"]);
  });

  it("is empty for a menu with nothing a worker backs", () => {
    expect(remoteMenu([{ id: "delete", label: "Delete…" }, { type: "separator" }])).toEqual([]);
  });
});
