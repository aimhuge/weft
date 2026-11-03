// A reply's text for the session lines (lib/line-deltas.ts): coalesced, redacted, the word being typed held back.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeltaStream, DELTA_MS } from "./line-deltas";
import { redactText } from "./share-redact";

vi.mock("./share-redact", async (real) => {
  const actual = await real<typeof import("./share-redact")>();
  return { redactText: vi.fn(actual.redactText) };
});

const KEY = "sk-ant-api03-" + "a1B2c3D4e5F6g7H8i9J0".repeat(4);

describe("createDeltaStream", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends whole words once per window, after what it already sent", () => {
    const sent: unknown[] = [];
    const s = createDeltaStream((e) => sent.push(e), () => 4);
    s.add("c1", "Hel");
    s.add("c1", "lo wor");
    vi.advanceTimersByTime(DELTA_MS);
    expect(sent).toEqual([{ t: "delta", cardId: "c1", index: 4, text: "Hello " }]);
    s.add("c1", "ld\nand");
    vi.advanceTimersByTime(DELTA_MS);
    expect(sent.at(-1)).toEqual({ t: "delta", cardId: "c1", index: 4, text: "world\n" });
    // Nothing new in whole words: nothing goes.
    s.add("c1", " ");
    s.add("c1", "x");
    vi.advanceTimersByTime(DELTA_MS);
    expect(sent.at(-1)).toEqual({ t: "delta", cardId: "c1", index: 4, text: "and " });
    vi.advanceTimersByTime(DELTA_MS);
    expect(sent).toHaveLength(3);
  });

  it("holds a single word back, and sends nothing for it", () => {
    const sent: unknown[] = [];
    const s = createDeltaStream((e) => sent.push(e), () => 0);
    s.add("c1", "partial");
    vi.advanceTimersByTime(DELTA_MS);
    expect(sent).toEqual([]);
  });

  it("redacts a key before it goes", () => {
    const sent: { text: string }[] = [];
    const s = createDeltaStream((e) => sent.push(e), () => 0);
    s.add("c1", `key ${KEY} done `);
    vi.advanceTimersByTime(DELTA_MS);
    expect(sent[0]?.text).not.toContain(KEY);
    expect(sent[0]?.text).toContain("‹hidden:");
  });

  it("resends the whole reply with reset when redaction rewrites what was sent", () => {
    const sent: unknown[] = [];
    const s = createDeltaStream((e) => sent.push(e), () => 0);
    s.add("c1", "abc def ");
    vi.advanceTimersByTime(DELTA_MS);
    vi.mocked(redactText).mockImplementationOnce(() => "‹hidden› ghi ");
    s.add("c1", "ghi ");
    vi.advanceTimersByTime(DELTA_MS);
    expect(sent).toEqual([
      { t: "delta", cardId: "c1", index: 0, text: "abc def " },
      { t: "delta", cardId: "c1", index: 0, text: "‹hidden› ghi ", reset: true },
    ]);
  });

  it("starts a new reply after end, at the thread's new length, and stop drops what's pending", () => {
    const sent: unknown[] = [];
    let len = 1;
    const s = createDeltaStream((e) => sent.push(e), () => len);
    s.add("c1", "one ");
    vi.advanceTimersByTime(DELTA_MS);
    s.end("c1");
    len = 3;
    s.add("c1", "two ");
    vi.advanceTimersByTime(DELTA_MS);
    expect(sent).toEqual([
      { t: "delta", cardId: "c1", index: 1, text: "one " },
      { t: "delta", cardId: "c1", index: 3, text: "two " },
    ]);
    s.add("c1", "three ");
    s.stop();
    vi.advanceTimersByTime(DELTA_MS);
    expect(sent).toHaveLength(2);
    s.stop();
  });
});
