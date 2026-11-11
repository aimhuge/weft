import { describe, expect, it } from "vitest";
import { blankNote, blanksOf, blanksOpenByDefault } from "./vault-blanks";
import type { VaultEnvironment, VaultSecret } from "./vault-view";

const s = (name: string, environment: VaultEnvironment, missing = false): VaultSecret => ({ name, environment, missing, tail: "", updatedAt: "" });

describe("blanksOf", () => {
  it("lists only blanks, by name then environment, with where each name has a value", () => {
    const rows = blanksOf([s("B", "production", true), s("A", "development", true), s("B", "development", true), s("A", "production"), s("C", "development")]);
    expect(rows.map((r) => `${r.secret.name}/${r.secret.environment}`)).toEqual(["A/development", "B/development", "B/production"]);
    expect(rows[0]?.elsewhere).toEqual(["production"]);
    expect(rows[1]?.elsewhere).toEqual([]);
  });
});

describe("blankNote", () => {
  it("says where it's set, else its environment unless development", () => {
    expect(blankNote({ secret: s("A", "development", true), elsewhere: ["preview", "production"] })).toBe("set in preview, production");
    expect(blankNote({ secret: s("A", "production", true), elsewhere: [] })).toBe("production");
    expect(blankNote({ secret: s("A", "development", true), elsewhere: [] })).toBeNull();
  });
});

describe("blanksOpenByDefault", () => {
  it("folds a long list beside values, opens otherwise", () => {
    expect(blanksOpenByDefault(20, 45, "")).toBe(false);
    expect(blanksOpenByDefault(20, 45, " stripe ")).toBe(true);
    expect(blanksOpenByDefault(20, 0, "")).toBe(true);
    expect(blanksOpenByDefault(3, 45, "")).toBe(true);
  });
});
