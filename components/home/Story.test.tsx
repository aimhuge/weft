// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "../test-utils";
import { BOARD, DEMO, GAME, LEVELS, OPEN, WHY } from "@/lib/home-story";
import CardDemo from "./CardDemo";
import Game, { sampleCloth } from "./Game";
import MiniBoard from "./MiniBoard";
import OpenSource from "./OpenSource";
import Why from "./Why";

// The weft.zip home page's story sections: the open card, why this board, the small board, the game and the source.

describe("CardDemo", () => {
  it("draws the thread's three replies and a pane scene for each", () => {
    const { container } = render(<CardDemo />);
    expect(container.querySelector(".wz-cdYou")?.textContent).toBe(DEMO.prompt);
    expect(container.querySelectorAll(".wz-cdSays")).toHaveLength(3);
    expect(Array.from(container.querySelectorAll(".wz-cdUrl")).map((n) => n.textContent)).toEqual(DEMO.scenes.map((s) => s.url));
    expect(container.querySelectorAll(".wz-cdSteps li")).toHaveLength(DEMO.planSteps.length);
    expect(container.querySelector(".wz-cdTourTitle")?.textContent).toBe(DEMO.review.title);
  });
});

describe("Why", () => {
  it("strikes what others leave you with over each answer", () => {
    const { container } = render(<Why />);
    expect(Array.from(container.querySelectorAll(".wz-whyThem")).map((n) => n.textContent)).toEqual(WHY.map((r) => r.them));
  });
});

describe("MiniBoard", () => {
  it("draws four columns, their cards and one traveler with a state per column", () => {
    const { container } = render(<MiniBoard />);
    expect(container.querySelectorAll(".wz-mbCol")).toHaveLength(4);
    expect(container.querySelectorAll(".wz-mbCard")).toHaveLength(BOARD.columns.flatMap((c) => c.cards).length + 1);
    expect(container.querySelectorAll(".wz-mbTraveler .wz-mbMeta")).toHaveLength(4);
    expect(container.querySelectorAll(".wz-point")).toHaveLength(BOARD.points.length);
  });
});

describe("Game", () => {
  it("lists the XP rules, the six levels and a link to a real profile", () => {
    const { container } = render(<Game />);
    expect(container.querySelectorAll(".wz-xp li")).toHaveLength(4);
    expect(Array.from(container.querySelectorAll(".wz-levels b")).map((n) => n.textContent)).toEqual(LEVELS.map((l) => l.title));
    expect(container.querySelector(".wz-bcNote a")?.getAttribute("href")).toBe(GAME.example.href);
  });

  it("fills the sample card's 26 weeks with the same pattern every time", () => {
    const cloth = sampleCloth();
    expect(cloth).toHaveLength(182);
    expect(cloth).toEqual(sampleCloth());
    expect(Math.min(...cloth)).toBe(0);
    expect(Math.max(...cloth)).toBe(4);
    expect(sampleCloth(2)).toHaveLength(14);
  });
});

describe("OpenSource", () => {
  it("links the repo, the changelog and the license", () => {
    const { container } = render(<OpenSource />);
    const hrefs = Array.from(container.querySelectorAll(".wz-openLinks a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([...OPEN.links.map((l) => l.href), OPEN.license.href]);
  });
});
