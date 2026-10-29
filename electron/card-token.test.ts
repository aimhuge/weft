import { describe, expect, it } from "vitest";
import { cardFinder, cardOf, signCard } from "./card-token.cjs";

// Which card a vault request is for, proven rather than claimed (docs/architecture/secrets.md).

const SECRET = "launch-token";
const card = "card-1";

describe("cardOf", () => {
  it("believes a card whose signature checks out", () => {
    const body = { card, cardSig: signCard(SECRET, card, "/secrets/fill") };
    expect(cardOf({ secret: SECRET, route: "/secrets/fill", body })).toBe(card);
  });

  it("turns away a card with no signature", () => {
    expect(cardOf({ secret: SECRET, route: "/secrets/fill", body: { card } })).toBe("");
  });

  it("turns away a signature made with the wrong secret", () => {
    const body = { card, cardSig: signCard("other-token", card, "/secrets/fill") };
    expect(cardOf({ secret: SECRET, route: "/secrets/fill", body })).toBe("");
  });

  it("turns away a signature made for another route", () => {
    // A signature for a fill can't be replayed on a run: the route is part of what was signed.
    const body = { card, cardSig: signCard(SECRET, card, "/secrets/fill") };
    expect(cardOf({ secret: SECRET, route: "/secrets/run", body })).toBe("");
  });

  it("turns away a card whose signature is for another card", () => {
    const body = { card, cardSig: signCard(SECRET, "card-2", "/secrets/fill") };
    expect(cardOf({ secret: SECRET, route: "/secrets/fill", body })).toBe("");
  });

  it("turns away everything when there is no secret to check against", () => {
    const body = { card, cardSig: signCard(SECRET, card, "/secrets/fill") };
    expect(cardOf({ secret: "", route: "/secrets/fill", body })).toBe("");
  });
});

describe("cardFinder", () => {
  it("answers with the proven card for one launch's token", () => {
    const find = cardFinder(SECRET);
    expect(find({ card, cardSig: signCard(SECRET, card, "/secrets/run") }, "/secrets/run")).toBe(card);
    expect(find({ card: "other" }, "/secrets/run")).toBe("");
  });
});
