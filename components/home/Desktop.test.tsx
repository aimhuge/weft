// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "../test-utils";
import { ANYWHERE, APPS, SCENE } from "@/lib/home-desktop";
import Anywhere from "./Anywhere";
import Apps from "./Apps";
import DesktopScene from "./DesktopScene";

// The weft.zip home page's desktop sections: the hero's drawn desktop, the apps on it and where it runs.

describe("DesktopScene", () => {
  it("draws the board, the thread's two replies, the pane's page, the Touch ID ask and the phone", () => {
    const { container } = render(<DesktopScene />);
    expect(container.querySelectorAll(".wz-dsCard")).toHaveLength(SCENE.cards.length);
    expect(container.querySelectorAll(".wz-dsCardOn")).toHaveLength(1);
    expect(container.querySelector(".wz-dsYou")?.textContent).toBe(SCENE.prompt);
    expect(Array.from(container.querySelectorAll(".wz-dsSays")).map((n) => n.textContent)).toEqual(SCENE.says);
    expect(container.querySelector(".wz-dsUrl")?.textContent).toBe(SCENE.url);
    expect(container.querySelector(".wz-dsVault b")?.textContent).toBe(SCENE.vault.name);
    expect(container.querySelector(".wz-dsPhone")).not.toBeNull();
  });
});

describe("Apps and Anywhere", () => {
  it("draws a tile per app and a card per place", () => {
    expect(render(<Apps />).container.querySelectorAll(".wz-app")).toHaveLength(APPS.length);
    expect(render(<Anywhere />).container.querySelectorAll(".wz-place")).toHaveLength(ANYWHERE.length);
  });
});
