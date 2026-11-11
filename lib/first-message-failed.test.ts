// Pure predicate: the "first message failed" condition behind the FirstMessageErrorBanner
// (components/FirstMessageErrorBanner.tsx). Only the open thread uses this; the inline error
// banner in ThreadView is gated to be the *not-first* case so they don't both render.
import { describe, expect, it } from "vitest";
import { firstMessageFailed, hostRerunModel, modelFamily } from "./first-message-failed";
import type { Card, ThreadItem } from "./types";

function card(over: Partial<Card> = {}): Card {
  return {
    id: "c1",
    title: "T",
    prompt: "do it",
    cwd: "/tmp",
    backend: "claude",
    permissionMode: "auto",
    column: "backlog",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function user(text: string, at = 1): ThreadItem {
  return { kind: "user", text, at };
}
function assistant(text: string, at = 2): ThreadItem {
  return { kind: "assistant", text, at };
}
function result(text: string, isError: boolean, at = 3): ThreadItem {
  return { kind: "result", text, isError, at };
}

describe("firstMessageFailed", () => {
  it("is true on a card with one user message, no assistant text, and an error", () => {
    const c = card({ error: "rate limit" });
    const items: ThreadItem[] = [user("hi"), result("rate limit", true)];
    expect(firstMessageFailed(c, items)).toBe(true);
  });

  it("is false when the assistant produced any text after the first user message", () => {
    const c = card({ error: "rate limit" });
    const items: ThreadItem[] = [user("hi"), assistant("working on it"), result("done", false)];
    expect(firstMessageFailed(c, items)).toBe(false);
  });

  it("is still true when assistant text is only whitespace (no useful progress)", () => {
    const c = card({ error: "rate limit" });
    const items: ThreadItem[] = [user("hi"), assistant("   \n  ")];
    expect(firstMessageFailed(c, items)).toBe(true);
  });

  it("is false when there is no error on the card", () => {
    const c = card();
    const items: ThreadItem[] = [user("hi")];
    expect(firstMessageFailed(c, items)).toBe(false);
  });

  it("is false on a live card (the thread is still running)", () => {
    const c = card({ error: "rate limit", column: "running" });
    expect(firstMessageFailed(c, [user("hi")])).toBe(false);
  });

  it("is false when the card has a pending question (an answer is the next action)", () => {
    const c = card({
      error: "rate limit",
      pending: { id: "p", toolName: "AskUserQuestion", title: "q", input: {}, questions: [] },
    });
    expect(firstMessageFailed(c, [user("hi")])).toBe(false);
  });

  it("is false when the thread has zero user messages (defensive)", () => {
    const c = card({ error: "rate limit" });
    expect(firstMessageFailed(c, [])).toBe(false);
  });

  it("is false when the thread has more than one user message", () => {
    // The first turn succeeded enough for the user to send a follow-up; rerunning the
    // first message now would discard that progress. Continue / Restart is the right path.
    const c = card({ error: "rate limit" });
    const items: ThreadItem[] = [user("first"), assistant("ok"), user("second")];
    expect(firstMessageFailed(c, items)).toBe(false);
  });

  it("ignores nullish entries in the items list (matches the thread page's signature)", () => {
    const c = card({ error: "rate limit" });
    const items: (ThreadItem | null | undefined)[] = [user("hi"), null, undefined, result("rate limit", true)];
    expect(firstMessageFailed(c, items)).toBe(true);
  });

  it("a tool call without assistant text is still a failed first message", () => {
    // The assistant started a tool but never produced visible text — the user sees no progress.
    const c = card({ error: "rate limit" });
    const items: ThreadItem[] = [user("hi"), { kind: "tool", name: "Bash", input: {}, at: 2 } as unknown as ThreadItem];
    expect(firstMessageFailed(c, items)).toBe(true);
  });
});

describe("hostRerunModel", () => {
  it("is the card's own CLI's default model", () => {
    expect(hostRerunModel({ backend: "claude" })).toBe("claude-fable-5-2");
    expect(hostRerunModel({ backend: "puku", model: "puku-ai-2.7" })).toBe("opus-4.8");
  });

  it("is the next model when the card already ran on the default", () => {
    expect(hostRerunModel({ backend: "claude", model: "claude-fable-5-2" })).toBe("claude-opus-5-5");
  });

  it("skips another version of the same family, which likely shares the limit", () => {
    expect(hostRerunModel({ backend: "claude", model: "claude-fable-5-1" })).toBe("claude-opus-5-5");
    expect(hostRerunModel({ backend: "puku", model: "puku-ai-2.8" })).toBe("opus-4.8");
  });

  it("names a model's family without its version", () => {
    expect(modelFamily("claude-fable-5-2")).toBe("claude-fable");
    expect(modelFamily("opus-4.8")).toBe("opus");
    expect(modelFamily("codex-default")).toBe("codex-default");
  });

  it("stays on a one-model CLI's own pick", () => {
    expect(hostRerunModel({ backend: "codex", model: "codex-default" })).toBe("codex-default");
  });
});
