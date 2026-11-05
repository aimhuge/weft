import { describe, expect, it } from "vitest";
import { gridlockChain, waitTargets, waitsOn, wouldGridlock } from "./wait-chain";

// The wait graph: which card waits on which. A card waits when one of its held requests is marked
// waiting and names the holder it waits for (lib/permission-wait.ts).

const targets = (pairs: [string, string][]) => waitTargets(pairs.map(([id, holderId]) => ({ id, holderId })));

describe("waitTargets", () => {
  it("maps each waiting card to the holder it waits on", () => {
    expect(targets([["a", "b"], ["c", "d"]])).toEqual(new Map([["a", ["b"]], ["c", ["d"]]]));
  });

  it("keeps every holder a card waits on, not just the first", () => {
    // Two held requests, two holders: both edges matter, and a loop through the second is a loop.
    expect(targets([["a", "b"], ["a", "c"]])).toEqual(new Map([["a", ["b", "c"]]]));
  });

  it("does not repeat a holder a card waits on twice", () => {
    expect(targets([["a", "b"], ["a", "b"]])).toEqual(new Map([["a", ["b"]]]));
  });

  it("is empty when nothing waits", () => {
    expect(targets([]).size).toBe(0);
  });
});

describe("waitsOn", () => {
  it("finds a direct wait", () => {
    expect(waitsOn(targets([["a", "b"]]), "a", "b")).toBe(true);
    expect(waitsOn(targets([["a", "b"]]), "b", "a")).toBe(false);
  });

  it("follows the chain, so a wait two cards away still counts", () => {
    const t = targets([["a", "b"], ["b", "c"]]);
    expect(waitsOn(t, "a", "c")).toBe(true);
    expect(waitsOn(t, "c", "a")).toBe(false);
  });

  it("ends the walk on a graph that already loops, instead of hanging", () => {
    const t = targets([["a", "b"], ["b", "a"]]);
    expect(waitsOn(t, "a", "z")).toBe(false);
  });
});

describe("wouldGridlock", () => {
  it("is false when the holder doesn't wait on this card", () => {
    expect(wouldGridlock(targets([["b", "c"]]), "a", "b")).toBe(false);
  });

  it("is true when the holder waits on this card", () => {
    expect(wouldGridlock(targets([["b", "a"]]), "a", "b")).toBe(true);
  });

  it("is true when the holder waits on this card through other cards", () => {
    // a waits on b, b waits on c, c waits on a: a waiting on c would close the loop.
    const t = targets([["a", "b"], ["b", "c"], ["c", "a"]]);
    expect(wouldGridlock(t, "a", "c")).toBe(true);
  });

  it("is true for a card waiting on itself", () => {
    expect(wouldGridlock(targets([]), "a", "a")).toBe(true);
  });

  it("sees a loop through a card's second wait, not only its first", () => {
    // a waits on b and on c; c waits on a. Waiting on c would close the loop — and c is a's second
    // wait, so a graph that kept only the first edge per card would miss it.
    const t = targets([["a", "b"], ["a", "c"], ["c", "a"]]);
    expect(wouldGridlock(t, "a", "c")).toBe(true);
  });

  it("is false when the chain leads somewhere else", () => {
    const t = targets([["b", "c"], ["c", "d"]]);
    expect(wouldGridlock(t, "a", "b")).toBe(false);
  });
});

describe("gridlockChain", () => {
  it("names the chain from this card to the holder", () => {
    // c waits on a, a waits on b, b waits on c: a waiting on c would close the loop.
    const t = targets([["a", "b"], ["b", "c"], ["c", "a"]]);
    expect(gridlockChain(t, "a", "c")).toEqual(["a", "c"]);
  });

  it("is empty when there is no loop", () => {
    expect(gridlockChain(targets([["b", "c"]]), "a", "b")).toEqual([]);
  });

  it("is the card itself for a self-wait", () => {
    expect(gridlockChain(targets([]), "a", "a")).toEqual(["a"]);
  });
});
