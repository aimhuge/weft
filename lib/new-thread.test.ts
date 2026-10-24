// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAFT,
  EFFORTS,
  LAST_BACKEND,
  LAST_CWD,
  CODEX_DEFAULT_MODEL,
  GOOSE_DEFAULT_MODEL,
  ALL_MODEL_IDS,
  BACKENDS,
  BACKEND_IDS,
  MODELS,
  effortFor,
  errorText,
  headline,
  lastEffort,
  modelFor,
  setLastEffort,
  setModelFor,
  modelLabel,
  problemWith,
  remember,
  rememberPicks,
  remembered,
  runningOn,
  modelOn,
  startButton,
} from "./new-thread";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("remembered / remember", () => {
  it("reads and writes localStorage, and null removes the key", () => {
    remember(DRAFT, "half a prompt");
    expect(remembered(DRAFT)).toBe("half a prompt");
    remember(DRAFT, null);
    expect(remembered(DRAFT)).toBeNull();
  });

  it("shrugs off a storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(remembered(DRAFT)).toBeNull();
    expect(() => remember(DRAFT, "x")).not.toThrow();
  });
});

describe("modelFor", () => {
  it("is no model until one is picked — there is no default model", () => {
    expect(modelFor("claude")).toBe("");
    expect(modelFor("puku")).toBe("");
    localStorage.setItem("weft.model.claude", "claude-haiku-5-5");
    expect(modelFor("claude")).toBe("claude-haiku-5-5");
  });

  it("takes the default Settings sets, with the effort beside it", () => {
    setModelFor("puku", "puku-ai-2.7");
    expect(modelFor("puku")).toBe("puku-ai-2.7");
    setLastEffort("low");
    expect(lastEffort()).toBe("low");
  });

  it("ignores a saved model the CLI no longer offers", () => {
    localStorage.setItem("weft.model.puku", "gone-1");
    expect(modelFor("puku")).toBe("");
  });
});

describe("effort", () => {
  it("starts at High, and keeps a saved choice, even Default", () => {
    expect(lastEffort()).toBe("high");
    localStorage.setItem("weft.effort", "");
    expect(lastEffort()).toBe("");
    localStorage.setItem("weft.effort", "max");
    expect(lastEffort()).toBe("max");
    localStorage.setItem("weft.effort", "nonsense");
    expect(lastEffort()).toBe("high");
    expect(EFFORTS.map((e) => e.id)).toContain("xhigh");
  });

  it("picks the closest effort the backend takes, and empty / undefined mean default", () => {
    // Claude takes everything.
    expect(effortFor("claude", "low")).toBe("low");
    expect(effortFor("claude", "xhigh")).toBe("xhigh");
    expect(effortFor("claude", "max")).toBe("max");
    // Puku takes low/medium/high/max, drops xhigh to high.
    expect(effortFor("puku", "low")).toBe("low");
    expect(effortFor("puku", "high")).toBe("high");
    expect(effortFor("puku", "max")).toBe("max");
    expect(effortFor("puku", "xhigh")).toBe("high");
    // "" / undefined pass through as undefined (use the model's own default).
    expect(effortFor("claude", "")).toBeUndefined();
    expect(effortFor("puku", "")).toBeUndefined();
    expect(effortFor("puku", undefined)).toBeUndefined();
  });
});

describe("rememberPicks", () => {
  it("keeps folder, CLI, that CLI's model and the effort for the next thread", () => {
    rememberPicks({ cwd: "/repo/web", backend: "puku", model: "puku-ai-2.8", effort: "" });
    expect(localStorage.getItem(LAST_CWD)).toBe("/repo/web");
    expect(localStorage.getItem(LAST_BACKEND)).toBe("puku");
    expect(modelFor("puku")).toBe("puku-ai-2.8");
    expect(lastEffort()).toBe("");
  });
});

describe("problemWith", () => {
  it("needs a prompt", () => {
    expect(problemWith("")).toBe("Write a prompt first.");
    expect(problemWith("Fix it")).toBeNull();
  });
});

describe("errorText / headline", () => {
  it("reads an Error's message or stringifies anything else", () => {
    expect(errorText(new Error("Folder not found"))).toBe("Folder not found");
    expect(errorText("plain")).toBe("plain");
  });

  it("is the first line without heading marks, cut to 60 characters", () => {
    expect(headline("## Add dark mode\nthen more")).toBe("Add dark mode");
    expect(headline("")).toBe("");
    expect(headline("x".repeat(80))).toHaveLength(60);
  });
});

describe("startButton", () => {
  it("names what ⌘↵ and ⌃↵ do while they're held", () => {
    expect(startButton({ mod: false, ctrl: false })).toEqual({ label: "Start now", key: "⌘" });
    expect(startButton({ mod: true, ctrl: false })).toEqual({ label: "Start & close", key: "⌘↵" });
    expect(startButton({ mod: false, ctrl: true })).toEqual({ label: "Start, keep open", key: "⌃↵" });
  });
});

describe("modelLabel", () => {
  it("names our models, and shortens any other id", () => {
    expect(modelLabel("claude-fable-5-1")).toBe("Fable 5.1");
    expect(modelLabel("claude-opus-5-5[1m]")).toBe("Opus 5.5");
    expect(modelLabel("puku-ai-2.8")).toBe("Puku AI 2.8");
    expect(modelLabel("claude-opus-4-1")).toBe("opus-4-1");
    expect(modelLabel("opus")).toBe("opus");
  });
});

describe("runningOn", () => {
  it("prefers the card's own picks over what its CLI's init reported", () => {
    const runsOn = { model: "claude-opus-5-5", effort: "xhigh" as const };
    expect(runningOn({ backend: "claude", stats: { runsOn } })).toEqual(runsOn);
    expect(runningOn({ backend: "claude", model: "claude-haiku-5-5", effort: "low", stats: { runsOn } })).toEqual({ model: "claude-haiku-5-5", effort: "low" });
    expect(runningOn({ backend: "claude" })).toEqual({ model: undefined, effort: undefined });
  });

  it("never names a Claude model on a puku card", () => {
    // The gateway would answer it as puku-ai-2.8, so the chip would lie: no model is better.
    expect(runningOn({ backend: "puku", model: "claude-fable-5-1" }).model).toBeUndefined();
  });
});

describe("modelOn", () => {
  it("keeps a model the CLI serves, [1m] suffix included", () => {
    expect(modelOn("puku", "puku-ai-2.7")).toBe("puku-ai-2.7");
    expect(modelOn("claude", "claude-opus-5-5[1m]")).toBe("claude-opus-5-5[1m]");
    expect(modelOn("claude", "claude-some-older")).toBe("claude-some-older");
  });

  it("drops the other CLI's model, so the CLI's own choice stands", () => {
    expect(modelOn("puku", "claude-fable-5-1")).toBeUndefined();
    expect(modelOn("claude", "puku-ai-2.8")).toBeUndefined();
  });

  it("keeps any model on a Goose card, whose providers serve their own ids", () => {
    // A local Ollama model, a private endpoint's id: no list can name them all, and dropping one
    // would silently run a different model than the card asked for.
    expect(modelOn("goose", "llama3.2")).toBe("llama3.2");
    expect(modelOn("goose", "some-private-endpoint/model-v2")).toBe("some-private-endpoint/model-v2");
    expect(modelOn("goose", "anthropic/claude-sonnet-4.5")).toBe("anthropic/claude-sonnet-4.5");
  });

  it("leaves no model as no model", () => {
    expect(modelOn("puku", undefined)).toBeUndefined();
  });

  it("drops the 'let the CLI decide' sentinels, so the card pins no model id", () => {
    // Codex's and Goose's own: a card on the sentinel runs on the CLI's choice, not on a fake id.
    expect(modelOn("codex", CODEX_DEFAULT_MODEL)).toBeUndefined();
    expect(modelOn("goose", GOOSE_DEFAULT_MODEL)).toBeUndefined();
  });

  it("keeps a real Goose model on a Goose card", () => {
    expect(modelOn("goose", "anthropic/claude-sonnet-4.5")).toBe("anthropic/claude-sonnet-4.5");
  });
});

// The shared lists. Every route that takes a backend or a model id checks against these, so a
// CLI the lists didn't name was dropped on the way in — the card ran on Claude Code while the
// dialog said Goose. These two tests are the guard: the lists have to cover every CLI.
describe("BACKEND_IDS", () => {
  it("names every CLI the picker offers", () => {
    expect([...BACKEND_IDS].sort()).toEqual(BACKENDS.map((b) => b.id).sort());
  });

  it("names every CLI the type allows", () => {
    // A CLI added to the Backend type but not to BACKENDS would be one the dialog can't offer
    // and no route would accept.
    const every: string[] = ["claude", "puku", "codex", "goose"];
    expect([...BACKEND_IDS].sort()).toEqual(every.sort());
  });

  it("has a model list for every CLI", () => {
    for (const backend of BACKEND_IDS) expect(MODELS[backend].length).toBeGreaterThan(0);
  });
});

describe("ALL_MODEL_IDS", () => {
  it("holds every model every CLI serves", () => {
    for (const backend of BACKEND_IDS) {
      for (const model of MODELS[backend]) expect(ALL_MODEL_IDS.has(model.id)).toBe(true);
    }
  });

  it("holds a Goose model, so a Goose card's model is accepted", () => {
    expect(ALL_MODEL_IDS.has(GOOSE_DEFAULT_MODEL)).toBe(true);
  });
});
