import { describe, expect, it, vi } from "vitest";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";

// lib/share-consent.ts: the first public share of a card asks, in every mode; after the user allowed it, or to take a
// link private, it goes through.
const cards = vi.hoisted(() => new Map<string, { shareConsent?: boolean }>());
vi.mock("./store", () => ({ getCard: (id: string) => cards.get(id) }));

const { SHARE_TOOL_NAME, shareConsentMatcher, shareDecision, shareQuestion } = await import("./share-consent");

const call = (cardId: string | undefined, toolInput: Record<string, unknown>, toolName = SHARE_TOOL_NAME, event = "PreToolUse") => {
  const matcher = shareConsentMatcher(() => cardId);
  const hook = matcher.hooks[0] as (input: HookInput, id: string | undefined, opts: { signal: AbortSignal }) => Promise<unknown>;
  const input = { hook_event_name: event, tool_name: toolName, tool_input: toolInput, session_id: "s", transcript_path: "", cwd: "/" } as unknown as HookInput;
  return hook(input, "t1", { signal: new AbortController().signal }) as Promise<{ hookSpecificOutput?: { permissionDecision: string; permissionDecisionReason: string } }>;
};

describe("shareDecision", () => {
  it("asks before a card's first public share, also when public is left out", () => {
    expect(shareDecision(undefined, {})).toBe("ask");
    expect(shareDecision({}, { public: true })).toBe("ask");
    expect(shareDecision({ shareConsent: false }, {})).toBe("ask");
  });

  it("lets a card the user already allowed through, and never asks to take a link private", () => {
    expect(shareDecision({ shareConsent: true }, { public: true })).toBe("allow");
    expect(shareDecision(undefined, { public: false })).toBe("allow");
  });
});

describe("shareQuestion", () => {
  it("says whether the chat goes public", () => {
    expect(shareQuestion({})).toContain("browser pane only, chat hidden");
    expect(shareQuestion({ show_chat: true })).toContain("with this thread's chat");
  });
});

describe("shareConsentMatcher", () => {
  it("matches only share_card", () => {
    expect(shareConsentMatcher(() => "c").matcher).toBe(SHARE_TOOL_NAME);
  });

  it("asks for a card that hasn't consented, in the prompt's words", async () => {
    cards.set("c1", {});
    const out = await call("c1", { public: true });
    expect(out.hookSpecificOutput).toMatchObject({ permissionDecision: "ask" });
    expect(out.hookSpecificOutput?.permissionDecisionReason).toMatch(/Publish this card/);
  });

  it("asks when the session has no card yet", async () => {
    expect((await call(undefined, undefined as never)).hookSpecificOutput?.permissionDecision).toBe("ask");
  });

  it("allows a card that consented before", async () => {
    cards.set("c2", { shareConsent: true });
    expect((await call("c2", {})).hookSpecificOutput?.permissionDecision).toBe("allow");
  });

  it("leaves other tools and events alone", async () => {
    expect(await call("c1", {}, "mcp__board__list_cards")).toEqual({});
    expect(await call("c1", {}, SHARE_TOOL_NAME, "PostToolUse")).toEqual({});
  });
});
