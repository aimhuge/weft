import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERSONAS } from "./copilot-personas";

const s = vi.hoisted(() => ({ threadPrompt: "", subagentModel: "choose" }));

vi.mock("./settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./settings")>()),
  threadPrompt: () => s.threadPrompt,
  subagentModel: () => s.subagentModel,
}));

type Prompts = typeof import("./weft-prompts");
const load = async (): Promise<Prompts> => import("./weft-prompts");

let prompts: Prompts;
let DEFAULT_THREAD_PROMPT: string;

beforeEach(async () => {
  vi.resetModules();
  ({ DEFAULT_THREAD_PROMPT } = await import("./settings"));
  s.threadPrompt = DEFAULT_THREAD_PROMPT;
  s.subagentModel = "choose";
  prompts = await load();
});

describe("weftSystemPrompt", () => {
  it("an isolated card's thread hears it works in its own worktree; a shared one doesn't", () => {
    expect(prompts.weftSystemPrompt({ backend: "claude", project: "/repo" })).toContain(prompts.ISOLATED_PROMPT);
    expect(prompts.weftSystemPrompt({ backend: "claude" })).not.toContain("This card is isolated");
  });

  it("a Claude thread gets every pinned part, in order", () => {
    const text = prompts.weftSystemPrompt({ backend: "claude" });
    const markers = [
      "SOUL.md and AGENTS.md",
      "browser pane",
      "mcp__secrets__ask_add",
      "mcp__webhooks__add_blank",
      "apply it yourself in the same turn",
      "AskUserQuestion tool",
      "mcp__board__restart_weft_when_idle",
      "Use subagents",
      "BOARD STATUS",
      "mcp__board__list_cards",
      "weft-review",
    ];
    let at = -1;
    for (const marker of markers) {
      const next = text.indexOf(marker, at + 1);
      expect(next, marker).toBeGreaterThan(at);
      at = next;
    }
    expect(text).not.toContain(prompts.WEFT_PINNED_PROMPTS.COPILOT_PROMPT);
  });

  it("the copilot gets the browser and copilot prompts, not the thread's", () => {
    const text = prompts.weftSystemPrompt({ backend: "claude", copilot: true });
    const { WEFT_SOUL_PROMPT, BROWSER_PROMPT, COPILOT_PROMPT, SECRETS_PROMPT, REVIEW_PROMPT } = prompts.WEFT_PINNED_PROMPTS;
    expect(text).toBe(`${WEFT_SOUL_PROMPT}\n\n${BROWSER_PROMPT}\n\n${COPILOT_PROMPT}`);
    for (const part of [DEFAULT_THREAD_PROMPT, SECRETS_PROMPT, REVIEW_PROMPT]) expect(text).not.toContain(part);
  });

  it("a thread on a Weft Worker gets the worker's browser prompt", async () => {
    vi.resetModules();
    vi.stubEnv("WEFT_WORKER", "1");
    const worker = await import("./weft-prompts");
    const text = worker.weftSystemPrompt({ backend: "claude" });
    vi.stubEnv("WEFT_WORKER", "");
    expect(text).toContain("You are running on a Weft Worker");
    expect(text).not.toContain(worker.WEFT_PINNED_PROMPTS.BROWSER_PROMPT);
  });

  it("a persona's prompt follows the copilot prompt; Wingman adds none", () => {
    const { COPILOT_PROMPT } = prompts.WEFT_PINNED_PROMPTS;
    const founder = prompts.weftSystemPrompt({ backend: "claude", copilot: true, persona: "founder" });
    expect(founder.endsWith(`${COPILOT_PROMPT}\n\n${PERSONAS.founder.prompt}`)).toBe(true);
    expect(prompts.weftSystemPrompt({ backend: "claude", copilot: true, persona: "wingman" })).toBe(prompts.weftSystemPrompt({ backend: "claude", copilot: true }));
    expect(prompts.WEFT_PINNED_PROMPTS.COPILOT_PERSONA_PROMPTS).toContain(PERSONAS.captain.prompt);
  });

  it("a puku thread's subagent part leaves out the Claude model picker", () => {
    expect(prompts.weftSystemPrompt({ backend: "claude" })).toContain("When unsure, pick sonnet");
    expect(prompts.weftSystemPrompt({ backend: "puku" })).not.toContain("When unsure, pick sonnet");
  });

  it("a Codex thread gets the migrations rule but not the buttons one", () => {
    const text = prompts.weftSystemPrompt({ backend: "codex" });
    expect(text).toContain(prompts.WEFT_PINNED_PROMPTS.MIGRATIONS_PROMPT);
    expect(text).not.toContain(prompts.WEFT_PINNED_PROMPTS.ASK_BUTTONS_PROMPT);
  });

  it("is memoized per build key, and follows a settings change", () => {
    const first = prompts.weftSystemPrompt({ backend: "claude" });
    expect(prompts.weftSystemPrompt({ backend: "claude" })).toBe(first);
    s.threadPrompt = "MY THREAD RULES";
    const edited = prompts.weftSystemPrompt({ backend: "claude" });
    expect(edited).toContain("MY THREAD RULES");
    expect(edited).not.toContain(DEFAULT_THREAD_PROMPT);
  });

  it("drops old entries once many settings have come and gone", () => {
    for (let i = 0; i < 10; i++) {
      s.threadPrompt = `rules ${i}`;
      expect(prompts.weftSystemPrompt({ backend: "claude" })).toContain(`rules ${i}`);
    }
  });
});

describe("promptsBuild", () => {
  it("is stable across reloads of the same text", async () => {
    const before = prompts.promptsBuild();
    vi.resetModules();
    expect((await load()).promptsBuild()).toBe(before);
  });

  it("changes with the thread prompt or the subagent model", () => {
    const before = prompts.promptsBuild();
    s.threadPrompt = "other";
    expect(prompts.promptsBuild()).not.toBe(before);
    s.threadPrompt = DEFAULT_THREAD_PROMPT;
    s.subagentModel = "inherit";
    expect(prompts.promptsBuild()).not.toBe(before);
  });

  // Each pinned string, edited in its own module, as a dev reload would load it.
  const sources: Array<[string, string]> = [
    ["./browser-tools", "BROWSER_PROMPT"],
    ["./board-tools", "COPILOT_PROMPT"],
    ["./secret-tools", "SECRETS_PROMPT"],
    ["./webhook-tools", "WEBHOOKS_PROMPT"],
    ["./decisions-prompt", "MIGRATIONS_PROMPT"],
    ["./decisions-prompt", "ASK_BUTTONS_PROMPT"],
    ["./env", "RESTART_PROMPT"],
    ["./settings", "DEFAULT_THREAD_PROMPT"],
    ["./review", "REVIEW_PROMPT"],
    ["./subagents", "DELEGATE"],
    ["./subagents", "CHOOSE"],
  ];

  it.each(sources)("flips when %s's %s changes", async (path, name) => {
    const before = prompts.pinnedPromptsHash();
    vi.resetModules();
    vi.doMock(path, async (importOriginal) => {
      const real = await importOriginal<Record<string, unknown>>();
      // ./settings keeps the test's stubs from the top-level mock.
      return path === "./settings" ? { ...real, threadPrompt: () => s.threadPrompt, subagentModel: () => s.subagentModel, [name]: "edited" } : { ...real, [name]: "edited" };
    });
    try {
      const reloaded = await load();
      expect(reloaded.pinnedPromptsHash()).not.toBe(before);
      expect(reloaded.promptsBuild()).not.toBe(prompts.promptsBuild());
    } finally {
      vi.doUnmock(path);
      if (path === "./settings") {
        vi.doMock("./settings", async (importOriginal) => ({
          ...(await importOriginal<typeof import("./settings")>()),
          threadPrompt: () => s.threadPrompt,
          subagentModel: () => s.subagentModel,
        }));
      }
    }
  });

  it("WEFT_SOUL_PROMPT is pinned too", () => {
    expect(Object.keys(prompts.WEFT_PINNED_PROMPTS)).toContain("WEFT_SOUL_PROMPT");
  });
});
