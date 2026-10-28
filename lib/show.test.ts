import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

    it("leaves a card that already has a page alone, so a brief it was handed survives", async () => {
      fs.writeFileSync(g.showFile("c2"), "<!doctype html><html><body>brief</body></html>");
      await g.showStarter("c2", "Design an agent", "help me design an agent");
      expect(h.openInPane).not.toHaveBeenCalled();
      expect(fs.readFileSync(g.showFile("c2"), "utf8")).toContain("brief");
    });
  });

  describe("openShowFile", () => {
    it("opens the card's own page in its pane", async () => {
      fs.writeFileSync(g.showFile("c3"), "<!doctype html><html><body>brief</body></html>");
      await g.openShowFile("c3");
      expect(opened()).toEqual([["/show/c3.html", "c3"]]);
    });

    it("does nothing when the card has no page", async () => {
      await g.openShowFile("c4");
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
