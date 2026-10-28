import { describe, expect, it } from "vitest";
import { backdropFor, extractHtml, newThreadPage, nextScene, showPrompt, starterPage } from "./show";
import { TIPS } from "./new-thread-tips";

// The pages show.ts writes: the page text, the scene behind it and the prompt Haiku is given.
// The pane side — what show.ts does with the pane — sits in show.test.ts.

describe("extractHtml", () => {
  it("takes the page out of a code fence and chat around it", () => {
    const text = "Here you go:\n```html\n<!doctype html>\n<html><body>hi</body></html>\n```\nEnjoy";
    expect(extractHtml(text)).toBe("<!doctype html>\n<html><body>hi</body></html>");
  });

  it("accepts a page that starts at <html>", () => {
    expect(extractHtml("<html lang=en><p>x</p></html>")).toBe("<html lang=en><p>x</p></html>");
  });

  it("keeps a page cut off before </html>", () => {
    expect(extractHtml("<!DOCTYPE html><p>cut")).toBe("<!DOCTYPE html><p>cut");
  });

  it("is undefined when there's no page", () => {
    expect(extractHtml("Sorry, I can't.")).toBeUndefined();
  });
});

describe("showPrompt", () => {
  it("asks the three questions and carries the ask and reply", () => {
    const prompt = showPrompt("make it faster", "Cut startup to 2s.");
    expect(prompt).toContain("How's it going?");
    expect(prompt).toContain("What should we do next?");
    expect(prompt).toContain('"make it faster"');
    expect(prompt).toContain("Cut startup to 2s.");
  });

  it("clips a huge reply", () => {
    expect(showPrompt("x", "y".repeat(50_000)).length).toBeLessThan(15_000);
  });
});

describe("starterPage", () => {
  it("escapes the title and ask", () => {
    const html = starterPage("<b>Fix</b>", 'say "hi" & <script>', new Date(2026, 9, 10, 12, 5));
    expect(html).toContain("&lt;b&gt;Fix&lt;/b&gt;");
    expect(html).toContain("say &quot;hi&quot; &amp; &lt;script&gt;");
    expect(html).not.toContain('say "hi" & <script>');
    expect(html).toContain("Working · since 12:05");
  });

  it("draws the card's scene, dimmed, behind a running clock", () => {
    const html = starterPage("Fix", "ask", new Date(2026, 9, 10, 12, 5), "card1");
    expect(html).toMatch(/url\("file:\/\/[^"]*\/assets\/[^"]+\.(jpe?g|png|webp)"\)/);
    expect(html).toContain('id="clock"');
    expect(html).toContain(`const start = ${new Date(2026, 9, 10, 12, 5).getTime()};`);
  });

  it("shows pasted images as thumbnails", () => {
    const html = starterPage("Fix", "![shot.png](/Users/me/.weft/attachments/shot one.png)\n\ncontinue");
    expect(html).toContain('<img src="file:///Users/me/.weft/attachments/shot%20one.png" alt="shot.png">');
    expect(html).not.toContain("![shot.png]");
  });
});

describe("backdropFor", () => {
  it("keeps a card on one scene and spreads cards across them", () => {
    const names = ["a.jpg", "b.jpg", "c.jpg"];
    expect(backdropFor("card1", names)).toBe(backdropFor("card1", names));
    const picked = new Set(Array.from({ length: 30 }, (_, i) => backdropFor(`card-${i}`, names)));
    expect(picked.size).toBe(3);
  });
});

describe("nextScene", () => {
  it("cycles through every scene in turn, then starts over", () => {
    const names = ["a.jpg", "b.jpg", "c.jpg"];
    const first = names.indexOf(nextScene(names));
    const seen = [names[first], nextScene(names), nextScene(names), nextScene(names)];
    expect(seen).toEqual([0, 1, 2, 3].map((i) => names[(first + i) % 3]));
    expect(nextScene([])).toBe("splash-speeder.jpg");
  });
});

describe("newThreadPage", () => {
  it("shows the scene it's given, the speeder by default", () => {
    expect(newThreadPage()).toContain("splash-speeder.jpg");
    expect(newThreadPage("backdrop-canyon.jpg")).toContain("backdrop-canyon.jpg");
  });

  it("is the splash with no ask yet", () => {
    const html = newThreadPage();
    expect(html).toContain("<h1>New thread</h1>");
    expect(html).toContain("Waiting for your prompt…");
    expect(html).not.toContain('class="ask"');
    expect(html).not.toContain('class="recipes"');
  });

  it("carries a rotating tip, linked to its intro when it knows Weft's origin", () => {
    expect(newThreadPage()).toContain('<div class="tip" id="tip">');
    const vault = TIPS.findIndex((t) => t.intro === "vault");
    expect(newThreadPage(undefined, { start: vault, origin: "http://localhost:3000" })).toContain('href="http://localhost:3000/intros/vault.html?live=1"');
  });
});
