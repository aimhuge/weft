import { describe, expect, it } from "vitest";
import { passkeyCode } from "./passkey-code";

describe("passkeyCode", () => {
  it("is the first 4 bytes of SHA-256 of the key, as XXXX-XXXX", async () => {
    // SHA-256 of the empty string starts e3b0c442.
    expect(await passkeyCode("")).toBe("E3B0-C442");
    expect(await passkeyCode("c3BraQ")).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(await passkeyCode("c3BraQ")).not.toBe(await passkeyCode("b3RoZXI"));
  });
});
