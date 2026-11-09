import { describe, expect, it } from "vitest";
import { vaultTokenLabel } from "./provider-vault-token";

describe("vaultTokenLabel", () => {
  it("names the secret and the vault, never a value", () => {
    expect(vaultTokenLabel({ name: "VERCEL_TOKEN", label: "aimhuge/weft" })).toBe("Use VERCEL_TOKEN from aimhuge/weft");
  });
});
