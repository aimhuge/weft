import { describe, expect, it } from "vitest";
import { batches, buildMessages, deadTokens, isActionable, isPushColumn, pushBody, type PushCard } from "./message";

const org = { id: "org-1", slug: "acme" };
const card = (extra: Partial<PushCard> = {}): PushCard => ({ id: "c1", title: "Fix login", ...extra });

describe("isPushColumn", () => {
  it("takes only needs_you and review", () => {
    expect(isPushColumn("needs_you")).toBe(true);
    expect(isPushColumn("review")).toBe(true);
    expect(isPushColumn("running")).toBe(false);
    expect(isPushColumn(undefined)).toBe(false);
  });
});

describe("pushBody", () => {
  it("says Ready for review in review", () => {
    expect(pushBody(card({ pending: { toolName: "Bash" } }), "review")).toBe("Ready for review");
  });
  it("uses the first non-empty question", () => {
    expect(pushBody(card({ pending: { questions: [{ question: "  " }, { question: "Which  auth?\n" }] } }), "needs_you")).toBe("Which auth?");
  });
  it("names the tool it wants to run", () => {
    expect(pushBody(card({ pending: { toolName: "Bash", title: "pnpm test" } }), "needs_you")).toBe("Wants to run pnpm test");
    expect(pushBody(card({ pending: { toolName: "Bash" } }), "needs_you")).toBe("Wants to run Bash");
    expect(pushBody(card({ pending: {} }), "needs_you")).toBe("Wants to run a tool");
  });
  it("says an MCP form is asking", () => {
    expect(pushBody(card({ pending: { elicitation: {} } }), "needs_you")).toBe("Asks you to choose");
    expect(pushBody(card({ pending: { elicitation: {}, title: "Pick a repo" } }), "needs_you")).toBe("Pick a repo");
  });
  it("falls back to remaining, the last line, then Needs you", () => {
    expect(pushBody(card({ remaining: "await your OK", lastLine: "x" }), "needs_you")).toBe("await your OK");
    expect(pushBody(card({ lastLine: "Which one?" }), "needs_you")).toBe("Which one?");
    expect(pushBody(card(), "needs_you")).toBe("Needs you");
  });
  it("clips long text", () => {
    const body = pushBody(card({ remaining: "a".repeat(400) }), "needs_you");
    expect(body).toHaveLength(178);
    expect(body.endsWith("…")).toBe(true);
  });
});

describe("isActionable", () => {
  it("is only a held prompt in needs_you", () => {
    expect(isActionable(card({ pending: { toolName: "Bash" } }), "needs_you")).toBe(true);
    expect(isActionable(card(), "needs_you")).toBe(false);
    expect(isActionable(card({ pending: { toolName: "Bash" } }), "review")).toBe(false);
  });
});

describe("buildMessages", () => {
  it("makes one message per token with the card's data", () => {
    const msgs = buildMessages(card({ pending: { toolName: "Bash" } }), "needs_you", org, ["t1", "t2"]);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({
      to: "t1",
      title: "Fix login",
      body: "Wants to run Bash",
      data: { cardId: "c1", org: "acme", orgId: "org-1", column: "needs_you" },
      sound: "default",
      priority: "high",
      categoryId: "needs_you",
    });
  });
  it("leaves the category off review and titles an untitled card Weft", () => {
    const [m] = buildMessages(card({ title: "" }), "review", org, ["t1"]);
    expect(m?.title).toBe("Weft");
    expect(m).not.toHaveProperty("categoryId");
  });
});

describe("batches", () => {
  it("splits into chunks of 100", () => {
    const parts = batches(Array.from({ length: 205 }, (_, i) => i));
    expect(parts.map((p) => p.length)).toEqual([100, 100, 5]);
    expect(batches([])).toEqual([]);
  });
});

describe("deadTokens", () => {
  it("picks the tokens Expo says aren't registered", () => {
    const msgs = buildMessages(card(), "review", org, ["a", "b", "c", "d"]);
    const dead = deadTokens(msgs, [
      { status: "ok", id: "1" },
      { status: "error", details: { error: "DeviceNotRegistered" } },
      { status: "error", details: { error: "MessageRateExceeded" } },
    ]);
    expect(dead).toEqual(["b"]);
  });
});
