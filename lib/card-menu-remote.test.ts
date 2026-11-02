// A worker card's right-click menu (lib/card-menu-remote.ts): the card's own menu, trimmed to what a remote host's
// verbs back, with its separators kept tidy.
import { describe, expect, it } from "vitest";
import { cardMenu, type MenuItem } from "./card-menu";
import { remoteMenu } from "./card-menu-remote";
import type { Card } from "./types";

const card = (over: Partial<Card> = {}) => ({ id: "c1", title: "Fix it", cwd: "worker://w1/ling", backend: "claude", permissionMode: "default", column: "review", sessionId: "s1", createdAt: 0, updatedAt: 0, ...over }) as Card;

const ids = (items: MenuItem[]) => items.map((i) => ("id" in i ? i.id : "—"));

describe("remoteMenu", () => {
  it("keeps rename, the moves, the modes a remote host takes, Run on, the marks, Share…, archive and Delete…", () => {
    const kept = ids(remoteMenu(cardMenu(card({ review: { dev: { command: "pnpm dev" } } as never }), null, true)));
    expect(kept).toEqual(expect.arrayContaining(["open", "rename", "move:done", "move:backlog", "mode:default", "mode:acceptEdits", "mode:auto", "new-here", "star", "tags", "share", "archive", "delete"]));
    expect(kept.some((id) => id.startsWith("switch:"))).toBe(true);
  });

  it("drops what reads or widens this Mac: skills, dev server, vault, agents, folder, skipping prompts", () => {
    const kept = ids(remoteMenu(cardMenu(card({ review: { dev: { command: "pnpm dev" } } as never }), null, true)));
    for (const gone of ["skill:weft:done", "dev:start", "vault:revoke", "mode:bypassPermissions", "reveal", "copy-path", "copy-resume"]) expect(kept).not.toContain(gone);
    expect(kept.some((id) => id.startsWith("agent:"))).toBe(false);
  });

  it("keeps Stop on a live card and Start on a Backlog one", () => {
    expect(ids(remoteMenu(cardMenu(card({ column: "running" }))))).toContain("stop");
    expect(ids(remoteMenu(cardMenu(card({ column: "backlog" }))))).toContain("start");
  });

  it("never starts, ends or doubles a separator", () => {
    const sep = { type: "separator" } as const;
    const out = remoteMenu([sep, { id: "skill:x", label: "x" }, sep, { id: "open", label: "Open" }, sep, sep, { id: "dev:start", label: "d" }, sep, { id: "star", label: "Star" }, sep, { id: "reveal", label: "R" }]);
    expect(ids(out)).toEqual(["open", "—", "star"]);
  });

  it("is empty for a menu with nothing a worker backs", () => {
    expect(remoteMenu([{ id: "reveal", label: "Reveal" }, { type: "separator" }])).toEqual([]);
  });
});

describe("remoteMenu where the board can sign a widening", () => {
  it("keeps the agents and skipping prompts for Touch ID, and only the agents for a passkey", () => {
    const menu = cardMenu(card());
    const desktop = ids(remoteMenu(menu, { agent: true, skip: true }));
    expect(desktop).toContain("mode:bypassPermissions");
    expect(desktop.some((id) => id.startsWith("agent:"))).toBe(true);
    const web = ids(remoteMenu(menu, { agent: true }));
    expect(web).not.toContain("mode:bypassPermissions");
    expect(web.some((id) => id.startsWith("agent:"))).toBe(true);
  });
});
