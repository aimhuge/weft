import { describe, expect, it } from "vitest";
import { cleanMessages, cleanSummary, MAX_MESSAGES, MAX_TEXT, MAX_TITLE, parseSummary, parseTurn, summaryPrompt, turnPrompt, WRAP_FAILED, WRAP_REPLY } from "./feedback";

const user = (text: string) => ({ role: "user" as const, text });
const bot = (text: string) => ({ role: "assistant" as const, text });

describe("cleanMessages", () => {
  it("keeps user and assistant messages with text, trimmed", () => {
    expect(cleanMessages([bot(" Hi "), user("It breaks"), { role: "system", text: "x" }, user("  "), null, { role: "user", text: 3 }])).toEqual([bot("Hi"), user("It breaks")]);
  });

  it("clips long text and keeps the newest messages", () => {
    const many = Array.from({ length: MAX_MESSAGES + 5 }, (_, i) => user(`m${i}`));
    const out = cleanMessages(many);
    expect(out).toHaveLength(MAX_MESSAGES);
    expect(out.at(-1)?.text).toBe(`m${MAX_MESSAGES + 4}`);
    expect(cleanMessages([user("x".repeat(MAX_TEXT + 10))])[0]?.text).toHaveLength(MAX_TEXT);
  });

  it("refuses a non-list or a transcript with nothing from the user", () => {
    expect(() => cleanMessages("hi")).toThrow("list");
    expect(() => cleanMessages([bot("Hi")])).toThrow("Say what's in your way");
  });
});

describe("cleanSummary", () => {
  it("trims and clips the title and body", () => {
    expect(cleanSummary({ title: " T ", body: " B " })).toEqual({ title: "T", body: "B" });
    expect(cleanSummary({ title: "t".repeat(200), body: "b" }).title).toHaveLength(MAX_TITLE);
  });

  it("needs both", () => {
    expect(() => cleanSummary({ title: "T" })).toThrow("title and a body");
    expect(() => cleanSummary({ title: " ", body: "B" })).toThrow();
    expect(() => cleanSummary(null)).toThrow();
  });
});

describe("turnPrompt", () => {
  it("carries the transcript and how many questions were asked", () => {
    const prompt = turnPrompt([bot("What's wrong?"), user("Cards vanish")]);
    expect(prompt).toContain("You've asked 1 question so far");
    expect(prompt).toContain("User: Cards vanish");
    expect(prompt).toContain("You: What's wrong?");
    expect(turnPrompt([user("a"), bot("b"), bot("c")])).toContain("2 questions");
  });

});

describe("summaryPrompt", () => {
  it("asks for the summary alone, from the transcript", () => {
    const prompt = summaryPrompt([user("Cards vanish")]);
    expect(prompt).toContain("Summarize");
    expect(prompt).toContain("User: Cards vanish");
    expect(prompt).not.toContain('"reply"');
  });
});

describe("parseSummary", () => {
  it("reads the summary, even inside a fence", () => {
    expect(parseSummary('```json\n{"title":"T","body":"- b"}\n```')).toEqual({ reply: WRAP_REPLY, summary: { title: "T", body: "- b" } });
  });

  it("says so when there's no usable summary", () => {
    expect(parseSummary("no json")).toEqual({ reply: WRAP_FAILED, summary: null });
    expect(parseSummary('{"title":"T"}')).toEqual({ reply: WRAP_FAILED, summary: null });
  });
});

describe("parseTurn", () => {
  it("reads a question", () => {
    expect(parseTurn('{"reply": " How often? ", "summary": null}')).toEqual({ reply: "How often?", summary: null });
  });

  it("reads a summary, even inside a fence", () => {
    expect(parseTurn('```json\n{"reply":"Thanks","summary":{"title":"Cards vanish","body":"- often"}}\n```')).toEqual({ reply: "Thanks", summary: { title: "Cards vanish", body: "- often" } });
  });

  it("drops a broken summary but keeps the reply", () => {
    expect(parseTurn('{"reply":"Thanks","summary":{"title":"x"}}')).toEqual({ reply: "Thanks", summary: null });
  });

  it("takes plain text, bad JSON or JSON without a reply as the reply", () => {
    expect(parseTurn("What happened next?")).toEqual({ reply: "What happened next?", summary: null });
    expect(parseTurn("{not json}")).toEqual({ reply: "{not json}", summary: null });
    expect(parseTurn('{"reply": ""}').reply).toBe('{"reply": ""}');
    expect(parseTurn("  ").reply).toContain("Could you say that again");
  });
});
