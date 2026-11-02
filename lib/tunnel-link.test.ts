import { describe, expect, it } from "vitest";
import { isTunnelAddress } from "./tunnel-link";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("isTunnelAddress", () => {
  it("takes Weft's own /t/<id>, with or without a path", () => {
    expect(isTunnelAddress(`https://weft.zip/t/${ID}`)).toBe(true);
    expect(isTunnelAddress(`https://weft.zip/t/${ID}/app?x=1#top`)).toBe(true);
  });

  it("refuses other sites, schemes, lookalikes and junk", () => {
    for (const bad of [
      `https://evil.example/t/${ID}`,
      `https://weft.zip.evil.example/t/${ID}`,
      `https://weftxzip/t/${ID}`,
      `javascript:alert(1)//https://weft.zip/t/${ID}`,
      `http://weft.zip/t/${ID}`,
      "https://weft.zip/t/not-an-id",
      `https://weft.zip/t/${ID}x`,
      `https://weft.zip/t/${ID}/${"a".repeat(600)}`,
      `https://weft.zip/t/${ID}/a b`,
      42,
      null,
    ])
      expect(isTunnelAddress(bad)).toBe(false);
  });
});
