import { describe, expect, it } from "vitest";
import { distinctHits, hitFrom, limitKind, readLine, resetOf, shortTokens, usageDays, WINDOW_MS, type LimitHit } from "./usage";

const at = new Date(2026, 9, 17, 12).getTime();
const HOUR = 60 * 60 * 1000;

const assistant = (extra: Record<string, unknown>, message: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "assistant", timestamp: new Date(at).toISOString(), ...extra, message: { id: "msg_1", model: "claude-opus-5-5", ...message } });

describe("limitKind", () => {
  it("reads the window a message names", () => {
    expect(limitKind("You've hit your session limit · resets 4:10am (Asia/Bangkok)", at)).toBe("five_hour");
    expect(limitKind("5-hour limit reached ∙ resets 9pm", at)).toBe("five_hour");
    expect(limitKind("You've hit your weekly limit · resets Oct 20, 9pm", at)).toBe("seven_day");
    expect(limitKind("Opus limit reached", at)).toBe("seven_day");
  });

  it("tells from the reset when the message names no window", () => {
    expect(limitKind("You've hit your limit · resets Oct 20, 9pm", at)).toBe("seven_day");
    expect(limitKind(`Claude AI usage limit reached|${Math.round((at + 2 * HOUR) / 1000)}`, at)).toBe("five_hour");
    expect(limitKind(`Claude AI usage limit reached|${Math.round((at + 48 * HOUR) / 1000)}`, at)).toBe("seven_day");
    expect(limitKind("You've hit your limit", at)).toBe("five_hour");
  });
});

describe("resetOf and hitFrom", () => {
  it("keeps the reset a message names", () => {
    expect(resetOf("You've hit your session limit · resets 4:10am (Asia/Bangkok)")).toBe("4:10am (Asia/Bangkok)");
    expect(resetOf("Claude AI usage limit reached|1760000000")).toBe("1760000000");
    expect(resetOf("You've hit your limit")).toBeUndefined();
  });

  it("takes plan limits, not the API's own rate limits", () => {
    expect(hitFrom("You've hit your session limit · resets 4:10am", at)).toEqual({ at, kind: "five_hour", reset: "4:10am" });
    expect(hitFrom("You've hit your limit", at)).toEqual({ at, kind: "five_hour" });
    expect(hitFrom("API Error: Rate limit reached", at)).toBeNull();
  });
});

describe("readLine", () => {
  it("counts a request's input, cache writes and output, not cache reads", () => {
    const line = assistant({ requestId: "req_1" }, { usage: { input_tokens: 10, cache_creation_input_tokens: 90, cache_read_input_tokens: 5000, output_tokens: 7 } });
    expect(readLine(line)).toEqual({ type: "tokens", at, key: "req_1", input: 100, output: 7 });
  });

  it("keys by the message id, then the line, when there's no request id", () => {
    expect(readLine(assistant({}, { usage: { output_tokens: 1 } }))).toMatchObject({ key: "msg_1" });
    expect(readLine(assistant({ uuid: "u1" }, { id: undefined, usage: { output_tokens: 1 } }))).toMatchObject({ key: "u1" });
    expect(readLine(assistant({}, { id: undefined, usage: { output_tokens: 1 } }))).toMatchObject({ key: String(at) });
  });

  it("reads a limit hit from the CLI's error message", () => {
    const line = assistant({ isApiErrorMessage: true }, { model: "<synthetic>", content: [{ type: "text", text: "You've hit your session limit · resets 4:10am" }, {}] });
    expect(readLine(line)).toEqual({ type: "hit", hit: { at, kind: "five_hour", reset: "4:10am" } });
    expect(readLine(assistant({ isApiErrorMessage: true }, { content: [{ type: "text", text: "API Error: ENOTFOUND" }] }))).toBeNull();
    expect(readLine(assistant({ isApiErrorMessage: true }, { content: "Not logged in" }))).toBeNull();
  });

  it("skips what isn't a counted request", () => {
    expect(readLine('{"type":"user"}')).toBeNull();
    expect(readLine('{"type":"assistant", oops')).toBeNull();
    expect(readLine(JSON.stringify({ type: "assistant", timestamp: "never", message: {} }))).toBeNull();
    expect(readLine(JSON.stringify({ type: "summary", note: "assistant", timestamp: new Date(at).toISOString(), message: {} }))).toBeNull();
    expect(readLine(JSON.stringify({ type: "assistant", timestamp: new Date(at).toISOString() }))).toBeNull();
    expect(readLine(assistant({}))).toBeNull();
    expect(readLine(assistant({}, { model: "<synthetic>", usage: { output_tokens: 3 } }))).toBeNull();
    expect(readLine(assistant({}, { usage: { input_tokens: 0, output_tokens: "x" } }))).toBeNull();
  });
});

describe("distinctHits", () => {
  const hit = (h: number, kind: LimitHit["kind"] = "five_hour", reset?: string): LimitHit => ({ at: at + h * HOUR, kind, ...(reset && { reset }) });

  it("counts every thread's hit of one window once", () => {
    expect(distinctHits([hit(1, "five_hour", "4am"), hit(0, "five_hour", "4am"), hit(2)])).toEqual([hit(0, "five_hour", "4am")]);
  });

  it("splits by window, reset and time", () => {
    const list = distinctHits([hit(0, "five_hour", "4am"), hit(1, "five_hour", "9am"), hit(6), hit(7, "seven_day"), hit(24 * 6, "seven_day"), hit(24 * 8, "seven_day")]);
    expect(list).toEqual([hit(0, "five_hour", "4am"), hit(1, "five_hour", "9am"), hit(6), hit(7, "seven_day"), hit(24 * 8, "seven_day")]);
    expect(WINDOW_MS.seven_day).toBe(168 * HOUR);
  });

  it("keeps a live thread's exact reset on the window it joins", () => {
    const live = { ...hit(1), resetAt: 99 };
    expect(distinctHits([hit(0, "five_hour", "4am"), live, { ...hit(2), resetAt: 7 }])).toEqual([{ ...hit(0, "five_hour", "4am"), resetAt: 99 }]);
  });
});

describe("usageDays", () => {
  it("lays out the last n days with their tokens and hits", () => {
    const tokens = new Map([["2026-10-16", [100, 20] as [number, number]]]);
    const hits: LimitHit[] = [
      { at: new Date(2026, 9, 17, 9).getTime(), kind: "five_hour" },
      { at: new Date(2026, 9, 17, 20).getTime(), kind: "five_hour" },
      { at: new Date(2026, 9, 17, 21).getTime(), kind: "seven_day" },
    ];
    expect(usageDays(tokens, hits, "2026-10-17", 3)).toEqual([
      { day: "2026-10-15", input: 0, output: 0, fiveHour: 0, sevenDay: 0 },
      { day: "2026-10-16", input: 100, output: 20, fiveHour: 0, sevenDay: 0 },
      { day: "2026-10-17", input: 0, output: 0, fiveHour: 2, sevenDay: 1 },
    ]);
    expect(usageDays(new Map(), [], "2026-10-17")).toHaveLength(30);
  });
});

it("shortTokens", () => {
  expect([2.5e9, 1.25e6, 340_400, 900].map(shortTokens)).toEqual(["2.5B", "1.3M", "340K", "900"]);
});
