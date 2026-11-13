import { describe, expect, it } from "vitest";
import { levelFor, XP } from "./game";
import { REPO } from "./home";
import { BOARD, DEMO, GAME, HERO, LEVELS, OPEN, WHY, xpRules } from "./home-story";

// lib/home-story.ts: what the weft.zip home page's story sections say.

describe("the home page's story", () => {
  it("leads with what a card does and names the three CLIs", () => {
    expect(`${HERO.title} ${HERO.titleEm}`).toBe("Every card builds it, then shows you.");
    for (const cli of ["Claude Code", "Codex", "Puku"]) expect(HERO.lede).toContain(cli);
  });

  it("plays the demo as three turns, each with a line and a page", () => {
    expect(DEMO.scenes.map((s) => s.id)).toEqual(["plan", "app", "review"]);
    for (const s of DEMO.scenes) expect(s.tab && s.says && s.url).toBeTruthy();
    expect(DEMO.planSteps).toHaveLength(3);
  });

  it("sets each of Weft's answers against what other boards leave you with", () => {
    expect(WHY).toHaveLength(4);
    for (const row of WHY) expect(row.them && row.title && row.body).toBeTruthy();
  });

  it("draws a board of four columns, each with a state and its cards", () => {
    expect(BOARD.columns.map((c) => c.name)).toEqual(["Backlog", "Running", "Review", "Done"]);
    for (const c of BOARD.columns) expect(c.state && c.cards.length).toBeTruthy();
    expect(BOARD.points).toHaveLength(4);
  });

  it("never says loom outside the level that is named Loom", () => {
    const copy = JSON.stringify([HERO, DEMO, WHY, BOARD, GAME, OPEN]);
    expect(copy).not.toMatch(/loom|woven|weav/i);
  });
});

describe("the game section", () => {
  it("starts each level title at the level the game gives it", () => {
    for (const { title, from } of LEVELS) {
      expect(levelFor(40 * (from - 1) ** 2).title).toBe(title);
      if (from > 1) expect(levelFor(40 * (from - 1) ** 2 - 1).title).not.toBe(title);
    }
  });

  it("quotes the game's own XP", () => {
    expect(xpRules().map((r) => r.xp)).toEqual([`+${XP.created}`, `+${XP.turn}`, `+${XP.done}`, "+15"]);
  });

  it("links a real public profile", () => {
    expect(GAME.example.href).toBe(`/@${GAME.example.handle}`);
    expect(GAME.body).toContain("Cotton to Gold Thread");
  });
});

describe("the source section", () => {
  it("links the repo, the releases and the license by its name", () => {
    expect(OPEN.links.map((l) => l.href)).toEqual([REPO, `${REPO}/releases`]);
    expect(OPEN.license.href).toBe(`${REPO}/blob/main/LICENSE`);
    expect(OPEN.license.label).toMatch(/^FSL/);
  });
});
