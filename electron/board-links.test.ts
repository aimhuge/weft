import { describe, expect, it } from "vitest";
import { boardLink } from "./board-links.cjs";

describe("boardLink", () => {
  it("opens a card", () => {
    expect(boardLink(new URL("weft://card/abc-123"))).toEqual(["open-card", "abc-123"]);
  });

  it("opens the 🔐 drawer on a repo, with or without the share dialog", () => {
    expect(boardLink(new URL("weft://secrets?repo=aimhuge%2Fweft&share=1"))).toEqual(["open-secrets", JSON.stringify({ repo: "aimhuge/weft", share: true })]);
    expect(boardLink(new URL("weft://secrets?repo=a/b"))).toEqual(["open-secrets", JSON.stringify({ repo: "a/b", share: false })]);
    expect(boardLink(new URL("weft://secrets"))).toEqual(["open-secrets", JSON.stringify({ repo: null, share: false })]);
  });

  it("leaves every other link alone", () => {
    expect(boardLink(new URL("weft://new?prompt=hi"))).toBeNull();
  });
});
