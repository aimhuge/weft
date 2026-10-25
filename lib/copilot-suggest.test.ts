import { afterEach, describe, expect, it, vi } from "vitest";
import { publish } from "./bus";
import { boardContext, boardKey, boardSuggestions, chipCardId, contextText, forgetSuggestions, parseSuggestions, startSuggestRefresh, suggestPrompt } from "./copilot-suggest";
import type { Card } from "./types";

const sources = vi.hoisted(() => ({ gatherSections: vi.fn(() => Promise.resolve([] as { title: string; lines: string[] }[])), SOURCES: [{ title: "S" }], activeProjects: vi.fn(() => ["/x/weft", "/x/groove"]), safeRoot: (cwd: string) => cwd }));
vi.mock("./copilot-sources", () => sources);
vi.mock("./copilot-setup", () => ({ SETUP_SOURCE: { title: "Not set up yet" }, SEED_SOURCE: { title: "Starter work Weft found" } }));
vi.mock("./store", () => ({ listCards: vi.fn(() => []) }));

const NOW = Date.UTC(2026, 9, 16, 14, 54);
const card = (over: Partial<Card>): Card => ({ id: "a", title: "Fix login", cwd: "/x/weft", column: "review", createdAt: NOW, updatedAt: NOW, ...over }) as Card;

afterEach(() => {
  forgetSuggestions();
  vi.useRealTimers();
});

describe("boardKey", () => {
  it("changes when a card moves or errors, not with order, and ignores closed cards", () => {
    const a = card({}), b = card({ id: "b", column: "backlog" });
    expect(boardKey([a, b])).toBe(boardKey([b, a]));
    expect(boardKey([a])).toBe(boardKey([a, card({ id: "d", column: "done" })]));
    expect(boardKey([a])).not.toBe(boardKey([{ ...a, column: "running" }]));
    expect(boardKey([a])).not.toBe(boardKey([{ ...a, error: "x" }]));
  });
});

describe("contextText and suggestPrompt", () => {
  it("puts the clock, the cards and each non-empty section in titled blocks", () => {
    const text = contextText([card({})], [{ title: "Uncommitted work", lines: ["- weft: 3 uncommitted files"] }, { title: "Empty", lines: [] }], NOW);
    expect(text).toMatch(/^Now: Friday/);
    expect(text).toContain('## Open cards, most urgent first\n- [review] · weft · "Fix login" · (id a)');
    expect(text).toContain("## Uncommitted work\n- weft: 3 uncommitted files");
    expect(text).not.toContain("## Empty");
    expect(text).not.toContain("Finished in the last day");
  });
  it("tells Haiku to spell out an option's meaning and lists the starters", () => {
    const prompt = suggestPrompt("CTX");
    expect(prompt).toContain('"Pick Option A, GitHub only, for the auth card", not "Pick Option A for the auth card"');
    expect(prompt).toContain("Let's commit all the new stuff");
    expect(prompt).toContain('"Link weft to Vercel so I can watch its deploys"');
    expect(prompt.endsWith("CTX")).toBe(true);
    expect(prompt).toContain("Suggest 4 things");
    expect(suggestPrompt("CTX", ["weft", "groove"])).toContain("up to 3 for each project (weft, groove), all in one list");
  });
});

describe("parseSuggestions", () => {
  it("takes the JSON object: trimmed, deduplicated, capped chips, known card ids, real starters only", () => {
    const reply = `Here:\n${JSON.stringify({
      chips: ["  Plain  ", { text: "Plain" }, { text: "Commit billing", cardId: "a" }, { text: "Ghost", cardId: "zzz" }, { text: "" }, 7, { text: "x".repeat(200) }, { text: "Fourth" }, { text: "Fifth" }],
      covers: ["Let's commit all the new stuff", "Let's commit all the new stuff", "Made up", 3],
    })}`;
    expect(parseSuggestions(reply, new Set(["a"]))).toEqual({
      chips: [{ text: "Plain" }, { text: "Commit billing", cardId: "a" }, { text: "Ghost" }, { text: "Fourth" }],
      covers: ["Let's commit all the new stuff"],
    });
  });
  it("labels each chip with its card's project, else the project it names, and keeps its own covers", () => {
    const reply = JSON.stringify({
      chips: [
        { text: "Commit billing", cardId: "a", project: "groove", covers: ["Let's commit all the new stuff", "Made up"] },
        { text: "Fix deploy", project: "groove" },
        { text: "Sign in", project: "nowhere" },
      ],
    });
    const known = { ids: new Set(["a"]), cardProject: new Map([["a", "/x/weft"]]), projects: new Map([["weft", "/x/weft"], ["groove", "/x/groove"]]) };
    expect(parseSuggestions(reply, known)).toEqual({
      chips: [
        { text: "Commit billing", cardId: "a", project: "/x/weft", covers: ["Let's commit all the new stuff"] },
        { text: "Fix deploy", project: "/x/groove" },
        { text: "Sign in" },
      ],
      covers: ["Let's commit all the new stuff"],
    });
  });
  it("gives none for no object, bad JSON or missing lists", () => {
    const none = { chips: [], covers: [] };
    expect(parseSuggestions("nothing")).toEqual(none);
    expect(parseSuggestions("{oops}")).toEqual(none);
    expect(parseSuggestions("{}")).toEqual(none);
    expect(parseSuggestions("null {} ")).toEqual(none);
  });
});

describe("boardSuggestions", () => {
  const reply = JSON.stringify({ chips: [{ text: "Commit Fix login", cardId: "a" }], covers: [] });

  it("runs nothing for an empty board", async () => {
    const ask = vi.fn();
    expect(await boardSuggestions([card({ column: "done" })], { ask })).toEqual({ chips: [], covers: [] });
    expect(ask).not.toHaveBeenCalled();
  });

  it("gathers the sources, asks Haiku once per board state and caches the answer for a while", async () => {
    const ask = vi.fn<(prompt: string) => Promise<string>>(() => Promise.resolve(reply));
    const gather = vi.fn(() => Promise.resolve([{ title: "GitHub", lines: ["- weft: open PR #3"] }]));
    let now = NOW;
    const deps = { ask, gather, now: () => now };
    const cards = [card({})];
    expect(await boardSuggestions(cards, deps)).toEqual({ chips: [{ text: "Commit Fix login", cardId: "a", project: "/x/weft" }], covers: [] });
    await boardSuggestions(cards, deps);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]?.[0]).toContain("## GitHub\n- weft: open PR #3");
    now += 16 * 60_000;
    await boardSuggestions(cards, deps);
    expect(ask).toHaveBeenCalledTimes(2);
    await boardSuggestions([card({ column: "needs_you" })], deps);
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it("uses the real sources and clock by default", async () => {
    const ask = vi.fn(() => Promise.resolve(reply));
    expect((await boardSuggestions([card({})], { ask })).chips).toHaveLength(1);
  });

  it("gives none on a failed run and tries again next time", async () => {
    const ask = vi.fn(() => Promise.reject(new Error("down")));
    const cards = [card({})];
    expect(await boardSuggestions(cards, { ask })).toEqual({ chips: [], covers: [] });
    await Promise.resolve();
    await boardSuggestions(cards, { ask });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("keeps a newer run when an older empty one finishes", async () => {
    let finish: (s: string) => void = () => {};
    const slow = vi.fn(() => new Promise<string>((r) => (finish = r)));
    const first = boardSuggestions([card({})], { ask: slow });
    const fast = vi.fn(() => Promise.resolve(reply));
    await boardSuggestions([card({ column: "running" })], { ask: fast });
    finish("no json");
    await first;
    await boardSuggestions([card({ column: "running" })], { ask: fast });
    expect(fast).toHaveBeenCalledTimes(1);
  });
});

describe("startSuggestRefresh", () => {
  it("makes fresh chips once the board settles after a move, once per server", async () => {
    vi.useFakeTimers();
    const ask = vi.fn(() => Promise.resolve(JSON.stringify({ chips: ["Hi"], covers: [] })));
    let cards = [card({})];
    const stop = startSuggestRefresh({ ask, cards: () => cards, delay: 1000 });
    expect(startSuggestRefresh()).toBe(stop);
    publish({ type: "delta", cardId: "a", text: "x" });
    publish({ type: "card", card: cards[0] as Card });
    publish({ type: "card_deleted", id: "z" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(ask).toHaveBeenCalledTimes(1);
    publish({ type: "card", card: cards[0] as Card });
    await vi.advanceTimersByTimeAsync(1000);
    expect(ask).toHaveBeenCalledTimes(1);
    cards = [card({ column: "running" })];
    publish({ type: "card", card: cards[0] as Card });
    await vi.advanceTimersByTimeAsync(1000);
    expect(ask).toHaveBeenCalledTimes(2);
    stop();
    publish({ type: "card", card: card({ id: "new" }) });
    await vi.advanceTimersByTimeAsync(1000);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("reads the board from the store by default", async () => {
    vi.useFakeTimers();
    const stop = startSuggestRefresh({ delay: 10 });
    publish({ type: "card_deleted", id: "z" });
    await vi.advanceTimersByTimeAsync(10);
    stop();
  });
});

describe("boardContext and chipCardId", () => {
  it("shows what Haiku reads, from every source and the setup checks", async () => {
    sources.gatherSections.mockResolvedValueOnce([{ title: "Not set up yet", lines: ["- weft: analytics not set up"] }]);
    const text = await boardContext([card({})]);
    expect(text).toContain("## Not set up yet\n- weft: analytics not set up");
    expect(sources.gatherSections).toHaveBeenLastCalledWith([card({})], [{ title: "S" }, { title: "Not set up yet" }, { title: "Starter work Weft found" }]);
    expect(await boardContext([card({})], { gather: () => Promise.resolve([]), now: () => NOW })).toMatch(/^Now: Friday/);
  });

  it("finds the card a sent chip is about, once the chips are in", async () => {
    expect(chipCardId("Commit Fix login")).toBeUndefined();
    const ask = () => Promise.resolve(JSON.stringify({ chips: [{ text: "Commit Fix login", cardId: "a" }, "Plain"], covers: [] }));
    await boardSuggestions([card({})], { ask });
    expect([chipCardId(" Commit Fix login "), chipCardId("Plain"), chipCardId("Other")]).toEqual(["a", undefined, undefined]);
  });
});
