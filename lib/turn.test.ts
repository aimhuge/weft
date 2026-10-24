import { describe, expect, it } from "vitest";
import type { ModelUsage } from "@anthropic-ai/claude-agent-sdk";
import {
  cacheAfter,
  eventWindow,
  modelStats,
  readQuestions,
  readResult,
  turnCost,
  usageWindow,
} from "./turn";

// A ModelUsage with only the fields modelStats reads. Cast through unknown so we can omit the rest
// the SDK type requires, per the task brief.
const usage = (over: Partial<{ costUSD: number; inputTokens: number; outputTokens: number; contextWindow: number }> = {}) =>
  ({
    costUSD: 0,
    inputTokens: 0,
    outputTokens: 0,
    contextWindow: 0,
    ...over,
  }) as unknown as ModelUsage;

// A real-looking BOARD STATUS line, taken from lib/status.test.ts.
const STATUS_LINE = "BOARD STATUS: column=review | stage=First shot | remaining=add a test, commit";
const RESULT_WITH_STATUS = `All done.\n\n${STATUS_LINE}`;

describe("readQuestions", () => {
  it("returns undefined when questions is missing", () => {
    expect(readQuestions({})).toBeUndefined();
  });

  it("returns undefined when questions is not an array", () => {
    expect(readQuestions({ questions: "nope" })).toBeUndefined();
    expect(readQuestions({ questions: { 0: {} } })).toBeUndefined();
    expect(readQuestions({ questions: null })).toBeUndefined();
  });

  it("keeps question, header, multiSelect (only literal true) and options with label and description", () => {
    const out = readQuestions({
      questions: [
        {
          question: "Which one?",
          header: "Pick",
          multiSelect: true,
          options: [
            { label: "A", description: "first" },
            { label: "B", description: "second" },
          ],
        },
      ],
    });
    expect(out).toEqual([
      {
        question: "Which one?",
        header: "Pick",
        multiSelect: true,
        options: [
          { label: "A", description: "first" },
          { label: "B", description: "second" },
        ],
      },
    ]);
  });

  it("keeps an option's preview, but not a blank or non-string one", () => {
    const out = readQuestions({
      questions: [{ question: "Q?", options: [{ label: "A", preview: "+--+" }, { label: "B", preview: "  " }, { label: "C", preview: 3 }] }],
    });
    expect(out?.[0]?.options).toEqual([
      { label: "A", description: undefined, preview: "+--+" },
      { label: "B", description: undefined },
      { label: "C", description: undefined },
    ]);
  });

  it("treats multiSelect truthy but not literal true as false", () => {
    const out = readQuestions({
      questions: [
        {
          question: "Q?",
          multiSelect: 1,
          options: [{ label: "A" }],
        },
      ],
    });
    expect(out?.[0]!.multiSelect).toBe(false);
  });

  it("drops null and non-object questions", () => {
    const out = readQuestions({
      questions: [null, "x", 42, true, { question: "OK", options: [{ label: "L" }] }],
    });
    expect(out).toHaveLength(1);
    expect(out?.[0]!.question).toBe("OK");
  });

  it("drops options without a label and non-object options", () => {
    const out = readQuestions({
      questions: [
        {
          question: "Q?",
          options: [
            null,
            "x",
            {},
            { label: "" },
            { label: "Keep", description: 7 },
            { description: "no label key" },
          ],
        },
      ],
    });
    expect(out?.[0]!.options).toEqual([{ label: "Keep", description: undefined }]);
  });

  it("drops questions with an empty question string", () => {
    const out = readQuestions({
      questions: [
        { question: "", options: [{ label: "L" }] },
        { options: [{ label: "L" }] },
        { question: "OK", options: [{ label: "L" }] },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out?.[0]!.question).toBe("OK");
  });

  it("returns undefined when nothing valid remains", () => {
    expect(readQuestions({ questions: [{ options: [{ label: "L" }] }] })).toBeUndefined();
    expect(readQuestions({ questions: [null, "x", 1] })).toBeUndefined();
  });
});

describe("readResult", () => {
  it("on success strips the status line and returns the status", () => {
    const out = readResult({ subtype: "success", result: RESULT_WITH_STATUS, isError: false, stopped: false });
    expect(out.summary).toBe("All done.");
    expect(out.isError).toBe(false);
    expect(out.status).toEqual({ column: "review", stage: "First shot", remaining: "add a test, commit" });
  });

  it("on success also strips a weft-review block from the summary", () => {
    const json = JSON.stringify({ steps: [{ title: "Sign-in", look: "Wrong password", path: "/login" }] });
    const result = `Done.\n\`\`\`weft-review\n${json}\n\`\`\`\n${STATUS_LINE}`;
    const out = readResult({ subtype: "success", result, isError: false, stopped: false });
    expect(out.summary).toBe("Done.");
    expect(out.isError).toBe(false);
    expect(out.status?.column).toBe("review");
  });

  it("reads 'Ended early: <subtype with underscores as spaces>' for a non-success subtype, with no status", () => {
    const out = readResult({ subtype: "error_max_turns", isError: true, stopped: false });
    expect(out.summary).toBe("Ended early: error max turns");
    expect(out.isError).toBe(true);
    expect(out.status).toBeUndefined();
  });

  it("appends the CLI's error message when a non-success subtype carries one", () => {
    const out = readResult({ subtype: "error_execution", result: "You've hit your usage limit.", isError: true, stopped: false });
    expect(out.summary).toBe("Ended early: error execution\n\nYou've hit your usage limit.");
    expect(out.isError).toBe(true);
    expect(out.status).toBeUndefined();
  });

  it("ignores a whitespace-only result on a non-success subtype", () => {
    const out = readResult({ subtype: "error_execution", result: "   \n  ", isError: true, stopped: false });
    expect(out.summary).toBe("Ended early: error execution");
  });

  it("a stopped turn says 'Stopped' and isError is false even if isError was true", () => {
    const out = readResult({ subtype: "success", result: RESULT_WITH_STATUS, isError: true, stopped: true });
    expect(out.summary).toBe("Stopped");
    expect(out.isError).toBe(false);
  });

  it("a stopped turn with a non-success subtype also says 'Stopped' and isError false", () => {
    const out = readResult({ subtype: "error_max_turns", isError: true, stopped: true });
    expect(out.summary).toBe("Stopped");
    expect(out.isError).toBe(false);
  });

  it("when not stopped, isError passes through", () => {
    expect(readResult({ subtype: "error_during_execution", isError: true, stopped: false }).isError).toBe(true);
    expect(readResult({ subtype: "success", result: "hi", isError: false, stopped: false }).isError).toBe(false);
  });
});

describe("turnCost", () => {
  it("with no base and total >= previous, base is 0 and cost is total", () => {
    expect(turnCost(2.5, 3.0, undefined)).toEqual({ base: 0, costUsd: 3.0 });
    expect(turnCost(1.0, 1.0, undefined)).toEqual({ base: 0, costUsd: 1.0 });
  });

  it("with no base and total < previous (a resumed session that restarted), base is previous and cost is previous + total", () => {
    expect(turnCost(5.0, 1.25, undefined)).toEqual({ base: 5.0, costUsd: 6.25 });
  });

  it("keeps an existing base of 0 whatever previous is", () => {
    expect(turnCost(10, 2, 0)).toEqual({ base: 0, costUsd: 2 });
  });

  it("keeps a non-zero existing base whatever previous is", () => {
    expect(turnCost(0, 0, 4.2)).toEqual({ base: 4.2, costUsd: 4.2 });
    expect(turnCost(99, 1, 4.2)).toEqual({ base: 4.2, costUsd: 5.2 });
  });
});

describe("eventWindow", () => {
  it("returns undefined without utilization", () => {
    expect(eventWindow({})).toBeUndefined();
    expect(eventWindow({ resetsAt: 1234 })).toBeUndefined();
  });

  it("turns a fraction into a rounded percent and passes resetsAt through", () => {
    expect(eventWindow({ utilization: 0.5, resetsAt: 1700000000 })).toEqual({ used: 50, resetsAt: 1700000000 });
    expect(eventWindow({ utilization: 0.123 })).toEqual({ used: 12, resetsAt: undefined });
    expect(eventWindow({ utilization: 0.999 })).toEqual({ used: 100, resetsAt: undefined });
  });

  it("utilization 0 still gives a window with used 0", () => {
    expect(eventWindow({ utilization: 0 })).toEqual({ used: 0, resetsAt: undefined });
  });
});

describe("usageWindow", () => {
  it("returns undefined for null or undefined window", () => {
    expect(usageWindow(undefined)).toBeUndefined();
    expect(usageWindow(null)).toBeUndefined();
  });

  it("returns undefined for null utilization", () => {
    expect(usageWindow({ utilization: null, resets_at: "2026-01-01T00:00:00Z" })).toBeUndefined();
  });

  it("rounds the percent as is (it is already a percentage there)", () => {
    expect(usageWindow({ utilization: 37.4, resets_at: null })).toEqual({ used: 37, resetsAt: undefined });
    expect(usageWindow({ utilization: 37.5, resets_at: null })).toEqual({ used: 38, resetsAt: undefined });
  });

  it("parses an ISO resets_at into unix seconds", () => {
    const iso = "2026-10-09T14:00:00Z";
    const expected = Date.parse(iso) / 1000;
    const out = usageWindow({ utilization: 50, resets_at: iso });
    expect(out).toEqual({ used: 50, resetsAt: expected });
  });

  it("null resets_at means resetsAt is undefined", () => {
    expect(usageWindow({ utilization: 0, resets_at: null })).toEqual({ used: 0, resetsAt: undefined });
  });
});

describe("modelStats", () => {
  it("empty or undefined usage gives undefined model, tokens and contextUsed", () => {
    expect(modelStats(undefined, undefined)).toEqual({ model: undefined, contextUsed: undefined, tokens: undefined });
    expect(modelStats({}, undefined)).toEqual({ model: undefined, contextUsed: undefined, tokens: undefined });
  });

  it("picks the model with the highest costUSD", () => {
    const u = {
      "claude-haiku": { costUSD: 0.01, inputTokens: 0, outputTokens: 0, contextWindow: 0 },
      "claude-opus": { costUSD: 1.2, inputTokens: 0, outputTokens: 0, contextWindow: 0 },
      "claude-sonnet": { costUSD: 0.4, inputTokens: 0, outputTokens: 0, contextWindow: 0 },
    } as unknown as Record<string, ModelUsage>;
    expect(modelStats(u, undefined).model).toBe("claude-opus");
  });

  it("sums input+output tokens across all models", () => {
    const u = {
      a: { costUSD: 1, inputTokens: 100, outputTokens: 50, contextWindow: 0 },
      b: { costUSD: 0.1, inputTokens: 25, outputTokens: 75, contextWindow: 0 },
    } as unknown as Record<string, ModelUsage>;
    expect(modelStats(u, undefined).tokens).toBe(250);
  });

  it("reports contextUsed from the top model, rounded and capped at 100", () => {
    const u = { top: usage({ contextWindow: 200_000 }), other: usage({ contextWindow: 100_000 }) };
    // 150k of 200k -> 75
    expect(modelStats(u, 150_000)).toEqual({ model: "top", contextUsed: 75, tokens: undefined });
    // 250k of 200k -> capped at 100
    expect(modelStats(u, 250_000)).toEqual({ model: "top", contextUsed: 100, tokens: undefined });
  });

  it("contextUsed is undefined without contextTokens or contextWindow", () => {
    const u1 = { a: usage({ contextWindow: 200_000 }) };
    expect(modelStats(u1, undefined).contextUsed).toBeUndefined();
    const u2 = { a: usage({ contextWindow: 0 }) };
    expect(modelStats(u2, 50_000).contextUsed).toBeUndefined();
  });

  it("returns tokens as undefined when the sum is 0", () => {
    const u = { a: usage({ inputTokens: 0, outputTokens: 0, contextWindow: 0 }) };
    expect(modelStats(u, undefined).tokens).toBeUndefined();
  });
});

describe("cacheAfter", () => {
  it("reads the hit share and size, and an hour's life from a 1-hour cache write", () => {
    const u = { input_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 90, cache_creation: { ephemeral_1h_input_tokens: 90 } };
    expect(cacheAfter(u, 1000)).toEqual({ at: 1000, ttl: 3600, hit: 90, tokens: 1000 });
  });

  it("reads five minutes from a 5-minute cache write", () => {
    const u = { input_tokens: 100, cache_creation: { ephemeral_5m_input_tokens: 50, ephemeral_1h_input_tokens: 0 } };
    expect(cacheAfter(u, 0, 3600)?.ttl).toBe(300);
  });

  it("keeps the earlier life when the request wrote nothing, five minutes at first", () => {
    expect(cacheAfter({ cache_read_input_tokens: 500 }, 0, 3600)).toEqual({ at: 0, ttl: 3600, hit: 100, tokens: 500 });
    expect(cacheAfter({ input_tokens: 5, cache_creation: null }, 0)?.ttl).toBe(300);
  });

  it("is undefined for a request with no input", () => {
    expect(cacheAfter(undefined, 0)).toBeUndefined();
    expect(cacheAfter({}, 0)).toBeUndefined();
    expect(cacheAfter({ input_tokens: null }, 0)).toBeUndefined();
  });
});
