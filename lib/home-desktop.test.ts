import { describe, expect, it } from "vitest";
import { ANYWHERE, APPS, CLOSING, DESKTOP_HERO, SCENE } from "./home-desktop";

// lib/home-desktop.ts: the weft.zip home page as the ultimate AI desktop.

describe("the desktop home page's words", () => {
  it("leads with the ultimate AI desktop and names the three CLIs", () => {
    expect(`${DESKTOP_HERO.title} ${DESKTOP_HERO.titleEm}`).toBe("The ultimate AI desktop.");
    for (const cli of ["Claude Code", "Codex", "Puku"]) expect(DESKTOP_HERO.lede).toContain(cli);
  });

  it("puts a dozen distinct apps on the desktop, each with an icon and one line", () => {
    expect(APPS).toHaveLength(12);
    expect(new Set(APPS.map((a) => a.name)).size).toBe(APPS.length);
    for (const app of APPS) expect(app.icon && app.name && app.body).toBeTruthy();
  });

  it("draws a scene with one live card, the card the thread works on", () => {
    expect(SCENE.cards.filter((c) => c.live).map((c) => c.title)).toEqual([SCENE.card]);
    expect(SCENE.says).toHaveLength(2);
  });

  it("runs on four kinds of screen and closes on a short line", () => {
    expect(ANYWHERE.map((p) => p.name)).toEqual(["Mac and Windows", "iPhone", "weft.zip", "Weft Workers"]);
    expect(CLOSING.title && CLOSING.titleEm).toBeTruthy();
  });

  it("never says loom or weaving", () => {
    expect(JSON.stringify([DESKTOP_HERO, APPS, SCENE, ANYWHERE, CLOSING])).not.toMatch(/loom|woven|weav/i);
  });
});
