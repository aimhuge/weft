import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { backdropFor, extractHtml, showPrompt, newThreadPage, nextScene, starterPage } from "./show";

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

});

// The pane side: a fresh copy of the module with the shell, Haiku and the store faked, and its pages
// written to a temp DATA_DIR. The assets folder doesn't exist, so the splash scene is the only backdrop.
describe("pages show writes and opens in the pane", () => {
  const h = {
    paneUrl: vi.fn<(key: string) => Promise<string | undefined>>(),
    paneThumb: vi.fn<(key: string) => Promise<Buffer | undefined>>(),
    openInPane: vi.fn<(url: string, key: string) => Promise<void>>(async () => {}),
    complete: vi.fn<(prompt: string) => Promise<string>>(),
    getCard: vi.fn<(id: string) => { id: string; title: string; prompt?: string; emoji?: string; titleBy?: "user" | "auto"; tags?: string[]; tagsBy?: "user" | "auto"; role?: "copilot" } | undefined>(),
    listCards: vi.fn(() => [{ tags: ["auth"] }, { tags: ["auth", "bug"] }]),
    decorateCard: vi.fn(),
    saveImageData: vi.fn(() => Promise.resolve({ url: "/api/attachments/pane-1.webp" })),
  };
  let g: typeof import("./show");
  let dataDir: string;
  const PAGE = "<!doctype html><html><body>update</body></html>";
  const turn = { ask: "Add login", reply: "Added the login page.", openedPane: false, isError: false, stopped: false };
  const opened = () => h.openInPane.mock.calls.map(([url, key]) => [url.replace(`file://${dataDir}`, ""), key]);

  // The thumbnail waits for the page to paint; keep the fake clock moving until the turn's work is done.
  async function settle(p: Promise<unknown>) {
    const state = { done: false };
    void p.finally(() => (state.done = true));
    for (let i = 0; i < 20 && !state.done; i++) await vi.advanceTimersByTimeAsync(1200);
    return p;
  }

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-show-"));
    vi.resetModules();
    vi.stubEnv("WEFT_ASSETS_DIR", path.join(dataDir, "no-assets"));
    vi.doMock("./browser-tools", () => ({ paneUrl: h.paneUrl, paneThumb: h.paneThumb, openInPane: h.openInPane }));
    vi.doMock("./haiku", () => ({ complete: h.complete }));
    vi.doMock("./store", () => ({ DATA_DIR: dataDir, getCard: h.getCard, decorateCard: h.decorateCard, listCards: h.listCards }));
    vi.doMock("./attachments", () => ({ saveImageData: h.saveImageData }));
    g = await import("./show");
  });

  afterAll(() => {
    for (const m of ["./browser-tools", "./haiku", "./store", "./attachments"]) vi.doUnmock(m);
    vi.unstubAllEnvs();
    vi.useRealTimers();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    h.paneUrl.mockResolvedValue("");
    h.paneThumb.mockResolvedValue(undefined);
    h.getCard.mockReturnValue({ id: "c1", title: "Login", prompt: "Add login", emoji: "🔐", tags: ["auth"] });
    h.complete.mockResolvedValue(PAGE);
  });

  it("falls back to the splash scene when the assets folder can't be read", () => {
    expect(g.backdropFor("any-card")).toBe("splash-speeder.jpg");
  });

  it("newThreadUrl writes the New thread page and returns its file url", () => {
    const url = g.newThreadUrl();
    expect(url).toBe(`file://${path.join(dataDir, "show", "new-thread.html")}`);
    expect(fs.readFileSync(g.showFile("new-thread"), "utf8")).toContain("<h1>New thread</h1>");
  });

  describe("showStarter", () => {
    it("opens the starter page in a blank pane", async () => {
      await g.showStarter("c1", "Fix <login>", "make it work");
      expect(opened()).toEqual([["/show/c1.html", "c1"]]);
      const html = fs.readFileSync(g.showFile("c1"), "utf8");
      expect(html).toContain("<h1>Fix &lt;login&gt;</h1>");
      expect(html).toContain("make it work");
    });

    it("leaves a pane that already shows a page, or no desktop app, alone", async () => {
      h.paneUrl.mockResolvedValueOnce("http://localhost:3000/");
      await g.showStarter("c1", "t", "a");
      h.paneUrl.mockResolvedValueOnce(undefined);
      await g.showStarter("c1", "t", "a");
      expect(h.openInPane).not.toHaveBeenCalled();
    });
  });

  describe("showAfterTurn", () => {
    it("writes Haiku's update page for a turn that showed nothing and opens it", async () => {
      h.complete.mockResolvedValueOnce("Sure:\n```html\n" + PAGE + "\n```");
      await settle(g.showAfterTurn("c1", turn, () => true));
      expect(h.complete).toHaveBeenCalledWith(g.showPrompt(turn.ask, turn.reply));
      expect(opened()).toEqual([["/show/c1.html", "c1"]]);
      expect(fs.readFileSync(g.showFile("c1"), "utf8")).toBe(PAGE);
    });

    it("writes nothing for an empty reply, a live app in the pane, or a Haiku reply with no page", async () => {
      await settle(g.showAfterTurn("c1", { ...turn, reply: "  \n" }, () => true));
      h.paneUrl.mockResolvedValueOnce("https://app.test/");
      await settle(g.showAfterTurn("c1", turn, () => true));
      h.complete.mockResolvedValueOnce("I can't write that.");
      await settle(g.showAfterTurn("c1", turn, () => true));
      expect(h.openInPane).not.toHaveBeenCalled();
    });

    it("drops the page and the thumbnail when a newer turn started meanwhile", async () => {
      h.paneThumb.mockResolvedValue(Buffer.from("jpg"));
      await settle(g.showAfterTurn("c1", turn, () => false));
      expect(h.openInPane).not.toHaveBeenCalled();
      expect(h.paneThumb).not.toHaveBeenCalled();
      expect(h.decorateCard).not.toHaveBeenCalled();
    });

    it("shrugs off a Haiku failure and still captures the thumbnail", async () => {
      h.complete.mockRejectedValueOnce(new Error("rate limited"));
      h.paneThumb.mockResolvedValueOnce(Buffer.from("jpg"));
      await expect(settle(g.showAfterTurn("c1", turn, () => true))).resolves.toBeUndefined();
      expect(h.saveImageData).toHaveBeenCalledWith(Buffer.from("jpg"), "pane.jpg", "image/jpeg");
      expect(h.decorateCard).toHaveBeenCalledWith("c1", { thumb: "/api/attachments/pane-1.webp" });
    });

    it("waits for the page to paint before capturing it", async () => {
      h.paneUrl.mockResolvedValueOnce("https://app.test/");
      const p = g.showAfterTurn("c1", turn, () => true);
      await vi.advanceTimersByTimeAsync(1100);
      expect(h.paneThumb).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      await p;
      expect(h.paneThumb).toHaveBeenCalledWith("c1");
    });

    it("does nothing more for a card that's gone", async () => {
      h.getCard.mockReturnValue(undefined);
      await g.showAfterTurn("gone", { ...turn, reply: "" }, () => true);
      expect(h.paneThumb).not.toHaveBeenCalled();
      expect(h.complete).not.toHaveBeenCalled();
    });

    it("asks Haiku once for a tile emoji when the card has none, keeping only a real emoji", async () => {
      const emojiReplies = ["Sure! 🔐", "no idea", new Error("down")];
      for (const reply of emojiReplies) {
        h.getCard.mockReturnValue({ id: "c1", title: "Login", prompt: "Add login", tags: ["auth"] });
        h.complete.mockImplementation((prompt) =>
          !prompt.startsWith("Reply with exactly one emoji") ? Promise.resolve(PAGE)
          : reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply));
        await settle(g.showAfterTurn("c1", { ...turn, reply: "" }, () => true));
      }
      expect(h.complete).toHaveBeenCalledWith(expect.stringContaining("Task: Login"));
      expect(h.decorateCard.mock.calls).toEqual([["c1", { emoji: "🔐" }]]);
    });
    describe("retitling", () => {
      const weak = { id: "c1", title: "Image attachment", prompt: "[Image #1]", emoji: "🔐", tags: ["bug"] };
      const titleCalls = () => h.complete.mock.calls.filter(([p]) => p.startsWith("Name this coding thread"));
      const reply = (title: string | Error) => (prompt: string) =>
        !prompt.startsWith("Name this coding thread") ? Promise.resolve(PAGE) : title instanceof Error ? Promise.reject(title) : Promise.resolve(title);

      it("renames a placeholder-titled card and takes its emoji for the tile", async () => {
        h.getCard.mockReturnValue(weak);
        h.complete.mockImplementation(reply("🐞 Compile Error: missing import"));
        await settle(g.showAfterTurn("c1", turn, () => true));
        expect(h.decorateCard).toHaveBeenCalledWith("c1", { title: "🐞 Compile Error: missing import", titleBy: "auto", emoji: "🐞" });
      });

      it("keeps the old emoji when the title has none", async () => {
        h.getCard.mockReturnValue(weak);
        h.complete.mockImplementation(reply("Compile error"));
        await settle(g.showAfterTurn("c1", turn, () => true));
        expect(h.decorateCard).toHaveBeenCalledWith("c1", { title: "Compile error", titleBy: "auto" });
      });

      it("leaves named cards, silent turns and bad replies alone", async () => {
        h.getCard.mockReturnValue({ ...weak, titleBy: "user" });
        await settle(g.showAfterTurn("c1", turn, () => true));
        h.getCard.mockReturnValue(weak);
        await settle(g.showAfterTurn("c1", { ...turn, reply: " " }, () => true));
        expect(titleCalls()).toHaveLength(0);
        for (const bad of ["  ", new Error("down")]) {
          h.complete.mockImplementation(reply(bad));
          await settle(g.showAfterTurn("c1", turn, () => true));
        }
        expect(titleCalls()).toHaveLength(2);
        expect(h.decorateCard).not.toHaveBeenCalled();
      });

      it("drops the title if you renamed the card meanwhile", async () => {
        h.getCard.mockReturnValueOnce(weak).mockReturnValue({ ...weak, title: "Mine", titleBy: "user" });
        h.complete.mockImplementation(reply("🐞 Auto"));
        await settle(g.showAfterTurn("c1", turn, () => true));
        expect(h.decorateCard).not.toHaveBeenCalledWith("c1", expect.objectContaining({ titleBy: "auto" }));
      });
    });

    describe("tagging", () => {
      const named = { id: "c1", title: "Login", prompt: "Add login", emoji: "🔐" };
      const nameCalls = () => h.complete.mock.calls.map(([p]) => p).filter((p) => /^(Name|Tag) this coding thread/.test(p));
      const answer = (text: string) => (prompt: string) => Promise.resolve(/^(Name|Tag) this coding thread/.test(prompt) ? text : PAGE);

      it("tags a named card from the board's vocabulary, asking only for tags", async () => {
        h.getCard.mockReturnValue(named);
        h.complete.mockImplementation(answer("Tags: Auth, UI"));
        await settle(g.showAfterTurn("c1", turn, () => true));
        expect(nameCalls()[0]).toMatch(/^Tag this coding thread/);
        expect(nameCalls()[0]).toContain("This board already uses: auth, bug.");
        expect(h.decorateCard).toHaveBeenCalledWith("c1", { tags: ["auth", "ui"], tagsBy: "auto" });
      });

      it("names and tags an unnamed, untagged card in one call", async () => {
        h.getCard.mockReturnValue({ ...named, title: "Image attachment" });
        h.complete.mockImplementation(answer("Title: 🐞 Build break\nTags: bug, build"));
        await settle(g.showAfterTurn("c1", turn, () => true));
        expect(nameCalls()).toHaveLength(1);
        expect(h.decorateCard).toHaveBeenCalledWith("c1", { title: "🐞 Build break", titleBy: "auto", emoji: "🐞", tags: ["bug", "build"], tagsBy: "auto" });
      });

      it("leaves tags you set, cleared or added meanwhile, and the copilot, alone", async () => {
        for (const card of [{ ...named, tagsBy: "user" as const }, { ...named, role: "copilot" as const }]) {
          h.getCard.mockReturnValue(card);
          await settle(g.showAfterTurn("c1", turn, () => true));
        }
        expect(nameCalls()).toHaveLength(0);
        h.getCard.mockReturnValueOnce(named).mockReturnValue({ ...named, tags: ["mine"], tagsBy: "user" });
        h.complete.mockImplementation(answer("Tags: bug"));
        await settle(g.showAfterTurn("c1", turn, () => true));
        h.getCard.mockReturnValueOnce(named).mockReturnValue(undefined);
        await settle(g.showAfterTurn("c1", turn, () => true));
        expect(h.decorateCard).not.toHaveBeenCalled();
      });
    });
  });
});
