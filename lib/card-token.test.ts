import { describe, expect, it, vi } from "vitest";

vi.mock("./shell-token", () => ({ shellToken: () => "tok" }));

const { cardProof, signCard } = await import("./card-token");
const { cardOf } = await import("../electron/card-token.cjs");

// The server signs the card a vault request is for, and Electron main checks it
// (docs/architecture/secrets.md). The two halves have to agree, so the test drives both.

describe("cardProof", () => {
  it("makes a signature main accepts for the same route", () => {
    const body = cardProof("c1", "/secrets/fill");
    expect(cardOf({ secret: "tok", route: "/secrets/fill", body })).toBe("c1");
  });

  it("makes a signature main refuses on another route", () => {
    const body = cardProof("c1", "/secrets/fill");
    expect(cardOf({ secret: "tok", route: "/secrets/run", body })).toBe("");
  });

  it("sends nothing when there is no card to prove", () => {
    expect(cardProof(undefined, "/secrets/fill")).toEqual({});
  });
});

describe("signCard", () => {
  it("is stable for the same card, route and secret", () => {
    expect(signCard("c1", "/secrets/fill")).toBe(signCard("c1", "/secrets/fill"));
    expect(signCard("c1", "/secrets/fill")).not.toBe(signCard("c2", "/secrets/fill"));
  });
});
