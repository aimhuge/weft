import { describe, expect, it } from "vitest";
import { cardMenu, columnMenu, resumeCommand, type MenuItem } from "./card-menu";
import { BUILT_IN_AGENTS } from "./agents";
import type { Card } from "./types";

function card(over: Partial<Card> = {}): Card {
  return { id: "c1", title: "T", prompt: "p", cwd: "/w", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, ...over };
}

const ids = (items: MenuItem[]) => items.flatMap((i) => ("id" in i ? [i.id] : []));
const item = (items: MenuItem[], id: string) => items.find((i) => "id" in i && i.id === id) as { enabled?: boolean; checked?: boolean; label: string; accelerator?: string } | undefined;

describe("cardMenu", () => {
  it("toggles the star, edits tags and shares, with their keys", () => {
    const plain = cardMenu(card());
    expect(item(plain, "star")).toMatchObject({ label: "Star", accelerator: "K" });
    expect(item(plain, "tags")).toMatchObject({ label: "Tags…", accelerator: "G" });
    expect(item(plain, "share")).toMatchObject({ label: "Share…", accelerator: "Shift+S" });
    expect(ids(plain).indexOf("share")).toBe(ids(plain).indexOf("tags") + 1);
    expect(item(cardMenu(card({ starred: true })), "star")?.label).toBe("Unstar");
  });

  it("offers every move except the card's own column, flat", () => {
    const m = ids(cardMenu(card({ column: "review" })));
    expect(m).toContain("move:done");
    expect(m).toContain("move:backlog");
    expect(m).not.toContain("move:review");
    expect(m).not.toContain("start");
  });

  it("ticks the card's permission mode, without YOLO for puku threads", () => {
    const m = cardMenu(card({ permissionMode: "auto" }));
    expect(item(m, "mode:auto")).toMatchObject({ checked: true });
    expect(item(m, "mode:default")).toMatchObject({ checked: false });
    expect(ids(m)).toContain("mode:bypassPermissions");
    expect(ids(cardMenu(card({ backend: "puku" })))).not.toContain("mode:bypassPermissions");
  });

  it("offers Start Now in Backlog", () => {
    expect(ids(cardMenu(card({ column: "backlog" })))).toContain("start");
  });

  it("disables moves and skills while a turn runs, and offers Stop", () => {
    const m = cardMenu(card({ column: "running" }));
    expect(ids(m)).toContain("stop");
    expect(item(m, "move:done")?.enabled).toBe(false);
    expect(item(m, "skill:weft:done")?.enabled).toBe(false);
    expect(ids(cardMenu(card()))).not.toContain("stop");
  });

  it("shows dev server items only when the review plan names one", () => {
    expect(ids(cardMenu(card())).some((id) => id.startsWith("dev:"))).toBe(false);
    const withDev = card({ review: { dev: "npm run dev", steps: [] } as unknown as Card["review"] });
    expect(ids(cardMenu(withDev, null))).toContain("dev:start");
    const up = ids(cardMenu(withDev, { state: "running", reachable: true, log: "" }));
    expect(up).toEqual(expect.arrayContaining(["dev:restart", "dev:stop"]));
    expect(up).not.toContain("dev:start");
  });

  it("copies a resume command only for Claude sessions", () => {
    expect(ids(cardMenu(card()))).not.toContain("copy-resume");
    expect(ids(cardMenu(card({ sessionId: "s1" })))).toContain("copy-resume");
    expect(ids(cardMenu(card({ sessionId: "s1", backend: "puku" as Card["backend"] })))).not.toContain("copy-resume");
  });

  it("gives every item its own key, none the open menu needs itself", () => {
    const dev = card({ column: "backlog", sessionId: "s1", review: { dev: "npm run dev", steps: [] } as unknown as Card["review"] });
    const menus = [cardMenu(dev, null), cardMenu(dev, { state: "running", reachable: true, log: "" }), cardMenu(card({ column: "running" }))];
    menus.push(columnMenu("done", { count: 2, archived: 1, showArchived: false }));
    for (const m of menus) {
      const keys = m.flatMap((i) => ("id" in i ? [i.accelerator] : []));
      expect(keys.every(Boolean)).toBe(true);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys.some((k) => /^(Enter|Return|Esc|Escape|Space|Up|Down|Left|Right)$/.test(k!))).toBe(false);
    }
    expect(item(cardMenu(card()), "move:done")).toMatchObject({ accelerator: "D" });
    expect(item(cardMenu(card()), "skill:weft:commit")).toMatchObject({ accelerator: "2" });
  });

  it("ticks the card's agent, Builder when it has none, and switches only between turns", () => {
    expect(item(cardMenu(card()), "agent:builder")).toMatchObject({ checked: true, label: "Agent: 🛠 Builder", accelerator: "Shift+W" });
    expect(item(cardMenu(card({ agent: "copywriter" })), "agent:copywriter")).toMatchObject({ checked: true, accelerator: "W" });
    const live = cardMenu(card({ column: "running", agent: "copywriter" }));
    expect(item(live, "agent:builder")?.enabled).toBe(false);
    expect(item(live, "agent:copywriter")?.enabled).toBe(true);
  });

  it("lists the agents you made after the built-ins, keyed ⌥1 on", () => {
    const agents = [...BUILT_IN_AGENTS, { id: "a-1", name: "Reviewer", emoji: "🔍", tagline: "", soul: "s" }];
    const menu = cardMenu(card({ agent: "a-1" }), null, undefined, agents);
    expect(item(menu, "agent:a-1")).toMatchObject({ label: "Agent: 🔍 Reviewer", checked: true, accelerator: "Alt+1" });
    expect(item(menu, "agent:builder")?.checked).toBe(false);
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `a-${i}`, name: `A${i}`, emoji: "🤖", tagline: "", soul: "s" }));
    expect(item(cardMenu(card(), null, undefined, [...BUILT_IN_AGENTS, ...many]), "agent:a-11")?.accelerator).toBeUndefined();
  });

  it("labels archive by state", () => {
    expect(item(cardMenu(card({ archived: true })), "archive")?.label).toBe("Unarchive");
  });

  it("offers the vault item only when the shell says whether the card has access", () => {
    // The shell can't say (a plain browser tab, an older shell): no item at all.
    expect(ids(cardMenu(card(), null, undefined)).some((id) => id.startsWith("vault:"))).toBe(false);
    // No standing access: give it.
    expect(item(cardMenu(card(), null, false), "vault:grant")).toMatchObject({ label: "Give 🔐 Vault Access for 1 Hour" });
    expect(ids(cardMenu(card(), null, false))).not.toContain("vault:revoke");
    // Standing access: take it back.
    expect(item(cardMenu(card(), null, true), "vault:revoke")).toMatchObject({ label: "Revoke 🔐 Vault Access" });
    expect(ids(cardMenu(card(), null, true))).not.toContain("vault:grant");
  });

  it("says when the card has hit its plan limit", () => {
    expect(item(cardMenu(card()), "switch:puku")?.label).toBe("Run on puku-cli");
    expect(item(cardMenu(card({ rateLimitHit: true })), "switch:puku")?.label).toBe("Run on puku-cli (hit plan limit)");
  });
});

describe("resumeCommand", () => {
  it("quotes folders with spaces", () => {
    expect(resumeCommand(card({ cwd: "/a b/it's", sessionId: "s1" }))).toBe(`cd '/a b/it'\\''s' && claude --resume s1`);
    expect(resumeCommand(card({ cwd: "/w/x", sessionId: "s1" }))).toBe("cd /w/x && claude --resume s1");
  });
});

describe("columnMenu", () => {
  it("offers a new thread everywhere and archive tools in Done", () => {
    expect(ids(columnMenu("review", { count: 3, archived: 2, showArchived: false }))).toEqual(["new"]);
    expect(ids(columnMenu("done", { count: 3, archived: 2, showArchived: false }))).toEqual(["new", "toggle-archived", "archive-done"]);
    expect(ids(columnMenu("done", { count: 0, archived: 0, showArchived: false }))).toEqual(["new"]);
  });
});

describe("cardMenu dev server items", () => {
  const withDev = card({ review: { dev: "npm run dev", steps: [] } as unknown as Card["review"] });

  it("counts a starting server, or a reachable one Weft didn't start, as up", () => {
    for (const dev of [{ state: "starting", log: "" }, { state: "stopped", reachable: true, log: "" }] as const) {
      const got = ids(cardMenu(withDev, dev as unknown as Parameters<typeof cardMenu>[1]));
      expect(got).toEqual(expect.arrayContaining(["dev:restart", "dev:stop"]));
      expect(got).not.toContain("dev:start");
    }
  });
});

describe("columnMenu archived toggle", () => {
  it("reads Hide Archived while archived cards are shown", () => {
    expect(item(columnMenu("done", { count: 0, archived: 2, showArchived: true }), "toggle-archived")?.label).toBe("Hide Archived");
    expect(item(columnMenu("done", { count: 0, archived: 2, showArchived: false }), "toggle-archived")?.label).toBe("Show 2 Archived");
  });
});
