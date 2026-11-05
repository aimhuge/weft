// The LAN port's limit (lib/lan-rate.ts): per address, in all, over a sliding window, with a capped address list.
import { describe, expect, it } from "vitest";
import { LAN_RATE, rateLimiter } from "./lan-rate";

describe("rateLimiter", () => {
  it("lets so many through per address per window, then more once the window slides", () => {
    let t = 0;
    const allow = rateLimiter({ perAddress: 2, total: 10, windowMs: 1_000, maxAddresses: 8 }, () => t);
    expect([allow("a"), allow("a"), allow("a")]).toEqual([true, true, false]);
    expect(allow("b")).toBe(true);
    t = 1_000;
    expect(allow("a")).toBe(true);
  });

  it("caps the total, whoever asks", () => {
    const allow = rateLimiter({ perAddress: 5, total: 3, windowMs: 1_000, maxAddresses: 8 }, () => 0);
    expect(["a", "b", "c", "d"].map(allow)).toEqual([true, true, true, false]);
  });

  it("caps the addresses it remembers, dropping ones gone quiet first", () => {
    let t = 0;
    const allow = rateLimiter({ perAddress: 5, total: 100, windowMs: 1_000, maxAddresses: 2 }, () => t);
    expect([allow("a"), allow("b"), allow("c")]).toEqual([true, true, false]);
    t = 1_500;
    expect(allow("c")).toBe(true);
  });

  it("defaults to LAN_RATE and the clock", () => {
    const allow = rateLimiter();
    const results = Array.from({ length: LAN_RATE.perAddress + 1 }, () => allow("x"));
    expect(results.at(-1)).toBe(false);
  });
});
