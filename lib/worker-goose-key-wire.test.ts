import { describe, expect, it } from "vitest";
import * as cjs from "../electron/worker-goose-key-wire.cjs";
import { GOOSE_KEY, GOOSE_KEY_ENVIRONMENT, gooseKeyAskMessage, gooseKeyCommand, gooseKeyName, gooseKeyPurpose } from "./worker-goose-key-wire";

const base = { nonce: "a".repeat(64), expiresAt: 5, providerId: "anthropic", baseUrl: "https://api-cli.puku.sh" };

describe("the Goose key ask's wire", () => {
  it("names the same tool and environment on both sides", () => {
    expect(cjs.GOOSE_KEY).toBe(GOOSE_KEY);
    expect(GOOSE_KEY).toBe("goose_key");
    expect(cjs.GOOSE_KEY_ENVIRONMENT).toBe(GOOSE_KEY_ENVIRONMENT);
  });

  it("signs the same message on both sides, covering the card, box key, ask, provider and endpoint", () => {
    const m = gooseKeyAskMessage("c1", "box", base);
    expect(cjs.gooseKeyAskMessage("c1", "box", base)).toBe(m);
    for (const change of [{ nonce: "b".repeat(64) }, { expiresAt: 6 }, { providerId: "openai" }, { baseUrl: "https://evil.example" }]) expect(gooseKeyAskMessage("c1", "box", { ...base, ...change })).not.toBe(m);
    expect(gooseKeyAskMessage("c2", "box", base)).not.toBe(m);
    expect(gooseKeyAskMessage("c1", "other", base)).not.toBe(m);
  });

  it("binds the sealed key to its card, ask, provider and endpoint, apart from a run's or a dev server's", () => {
    const command = gooseKeyCommand("anthropic", "https://a");
    expect(cjs.gooseKeyCommand("anthropic", "https://a")).toBe(command);
    expect(cjs.gooseKeyPurpose("c", "n", command)).toBe(gooseKeyPurpose("c", "n", command));
    expect(gooseKeyPurpose("c", "n", command)).toMatch(/^goose-key:c:n:[0-9a-f]{64}$/);
    expect(gooseKeyPurpose("c", "n", gooseKeyCommand("anthropic", "https://b"))).not.toBe(gooseKeyPurpose("c", "n", command));
  });

  it("knows which providers take a key, and in which variable", () => {
    expect(gooseKeyName("anthropic")).toBe("ANTHROPIC_API_KEY");
    expect(gooseKeyName("custom")).toBe("GOOSE_PROVIDER__API_KEY");
    expect(gooseKeyName("ollama")).toBeNull();
    expect(gooseKeyName("")).toBeNull();
    expect(gooseKeyName("nope")).toBeNull();
  });
});
