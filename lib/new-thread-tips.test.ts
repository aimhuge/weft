import { describe, expect, it } from "vitest";
import { isIntro } from "./feature-intros";
import { nextTipIndex, tipCard, TIPS, TIP_CSS } from "./new-thread-tips";

describe("TIPS", () => {
  it("are short, and a drawer's tip names a real intro", () => {
    for (const tip of TIPS) {
      expect(tip.text.length).toBeLessThan(140);
      if (tip.intro) expect(isIntro(tip.intro)).toBe(true);
    }
  });
});

describe("nextTipIndex", () => {
  it("steps one tip on each time, wrapping, and is 0 with no tips", () => {
    const first = nextTipIndex(3);
    expect(nextTipIndex(3)).toBe((first + 1) % 3);
    expect(nextTipIndex()).toBeLessThan(TIPS.length);
    expect(nextTipIndex(0)).toBe(0);
  });
});

describe("tipCard", () => {
  const tips = [{ text: "Press <⌘K>" }, { text: "Keys stay in the vault", intro: "vault" as const }];

  it("starts on the tip it's given, escaped, with every tip for the page's own rotation", () => {
    const html = tipCard(tips, 2);
    expect(html).toContain('<span id="tip-text">Press &lt;⌘K&gt;</span>');
    expect(html).not.toContain("<⌘K>");
    expect(html).toContain("\\u003c⌘K>");
    expect(html).toContain("setInterval");
  });

  it("links a drawer's tip to its intro on Weft's origin, and not without one", () => {
    expect(tipCard(tips, 1, "http://localhost:3000")).toContain('<a class="watch" href="http://localhost:3000/intros/vault.html?live=1">▶ Watch</a>');
    expect(tipCard(tips, 1)).not.toContain('<a class="watch" href="http');
  });

  it("is nothing with no tips", () => {
    expect(tipCard([], 0)).toBe("");
  });

  it("has its own look", () => {
    expect(TIP_CSS).toContain(".tip{");
  });
});
