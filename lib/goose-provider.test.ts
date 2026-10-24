// lib/goose-provider.ts: the board's view of Goose's providers. The point of most of these is the same — the key
// itself never reaches the board, so the view's serialised form never holds one.
import { describe, expect, it } from "vitest";
import {
  GOOSE_PROVIDERS,
  PUKU_GOOSE,
  configuredProviders,
  gooseBridge,
  gooseEnvFor,
  gooseModelFor,
  keyForgottenText,
  keySavedText,
  needsBaseUrl,
  providerById,
  providerRow,
  type GooseProviderView,
} from "./goose-provider";

const provider = (over: Partial<GooseProviderView> = {}): GooseProviderView => ({
  id: "openrouter",
  label: "OpenRouter",
  envKey: "OPENROUTER_API_KEY",
  hasKey: false,
  ...over,
});

describe("gooseEnvFor", () => {
  it("puts the key in the provider's own variable", () => {
    expect(gooseEnvFor("openrouter", "sk-or-abc")).toEqual({ OPENROUTER_API_KEY: "sk-or-abc" });
    expect(gooseEnvFor("anthropic", "sk-ant-abc")).toEqual({ ANTHROPIC_API_KEY: "sk-ant-abc" });
    expect(gooseEnvFor("groq", "gsk-abc")).toEqual({ GROQ_API_KEY: "gsk-abc" });
  });

  it("puts a custom provider's key and host in the generic override", () => {
    expect(gooseEnvFor("custom", "sk-custom", { baseUrl: "https://api.example.com/v1" })).toEqual({
      GOOSE_PROVIDER__API_KEY: "sk-custom",
      GOOSE_PROVIDER__HOST: "https://api.example.com/v1",
    });
  });

  it("needs a base URL for a custom provider", () => {
    expect(() => gooseEnvFor("custom", "sk-custom")).toThrow(/needs a base URL/);
  });

  it("puts the endpoint beside the key for Azure and LiteLLM", () => {
    expect(gooseEnvFor("azure", "az-abc", { baseUrl: "https://r.openai.azure.com" })).toEqual({
      AZURE_OPENAI_API_KEY: "az-abc",
      AZURE_OPENAI_ENDPOINT: "https://r.openai.azure.com",
    });
    expect(gooseEnvFor("litellm", "lit-abc", { baseUrl: "http://localhost:4000" })).toEqual({
      LITELLM_API_KEY: "lit-abc",
      LITELLM_HOST: "http://localhost:4000",
    });
  });

  it("puts the host beside the key for Anthropic, so a gateway like Puku's is reached", () => {
    expect(gooseEnvFor("anthropic", "sk-ant-abc", { baseUrl: "https://api-cli.puku.sh" })).toEqual({
      ANTHROPIC_API_KEY: "sk-ant-abc",
      ANTHROPIC_HOST: "https://api-cli.puku.sh",
    });
  });

  it("leaves the endpoint out when there is none", () => {
    expect(gooseEnvFor("azure", "az-abc")).toEqual({ AZURE_OPENAI_API_KEY: "az-abc" });
    expect(gooseEnvFor("anthropic", "sk-ant-abc")).toEqual({ ANTHROPIC_API_KEY: "sk-ant-abc" });
  });

  it("refuses a provider it doesn't know, and an empty key", () => {
    expect(() => gooseEnvFor("nope", "abc")).toThrow(/doesn't know a provider called "nope"/);
    expect(() => gooseEnvFor("openrouter", "  ")).toThrow(/no OpenRouter key saved/);
  });
});

describe("providerById", () => {
  it("finds a provider in the catalog", () => {
    expect(providerById("openrouter")?.envKey).toBe("OPENROUTER_API_KEY");
    expect(providerById("custom")?.envKey).toBe("GOOSE_PROVIDER__API_KEY");
  });

  it("is null for one that isn't there", () => {
    expect(providerById("nope")).toBeNull();
    expect(providerById("")).toBeNull();
  });
});

describe("gooseModelFor", () => {
  it("is what the user saved", () => {
    expect(gooseModelFor("openrouter", { model: "my-model" })).toBe("my-model");
  });

  it("falls back to the first curated model", () => {
    expect(gooseModelFor("openrouter")).toBe("anthropic/claude-sonnet-4.5");
  });

  it("is empty for a provider with no curated list", () => {
    expect(gooseModelFor("groq")).toBe("");
  });
});

describe("needsBaseUrl", () => {
  it("is true for the providers that need an endpoint", () => {
    expect(needsBaseUrl("custom")).toBe(true);
    expect(needsBaseUrl("azure")).toBe(true);
    expect(needsBaseUrl("litellm")).toBe(true);
    // Anthropic's host is optional, but a gateway behind it (Puku's) needs one.
    expect(needsBaseUrl("anthropic")).toBe(true);
  });

  it("is false for the rest", () => {
    expect(needsBaseUrl("openrouter")).toBe(false);
    expect(needsBaseUrl("openai")).toBe(false);
  });
});

describe("PUKU_GOOSE", () => {
  it("is Anthropic's provider, the gateway's host and the model it serves", () => {
    expect(PUKU_GOOSE.providerId).toBe("anthropic");
    expect(PUKU_GOOSE.baseUrl).toBe("https://api-cli.puku.sh");
    expect(PUKU_GOOSE.modelId).toBe("puku-ai-2.8");
  });

  it("names a host without /v1, because Goose appends v1/messages itself", () => {
    expect(PUKU_GOOSE.baseUrl).not.toContain("/v1");
  });

  it("is a provider the catalog knows, whose env carries the host", () => {
    expect(providerById(PUKU_GOOSE.providerId)).not.toBeNull();
    expect(gooseEnvFor(PUKU_GOOSE.providerId, "sk-ant-abc", { baseUrl: PUKU_GOOSE.baseUrl })).toEqual({
      ANTHROPIC_API_KEY: "sk-ant-abc",
      ANTHROPIC_HOST: PUKU_GOOSE.baseUrl,
    });
  });
});

describe("the view", () => {
  it("never holds a key, in any form it is serialised in", () => {
    const view = provider({ hasKey: true, baseUrl: "https://api.example.com/v1", model: "my-model" });
    const row = providerRow(view);
    expect(row.hasKey).toBe(true);
    expect(Object.keys(row)).not.toContain("token");
    expect(JSON.stringify(row)).not.toContain("sk-or-abc");
  });

  it("lists the providers with a key, in catalog order", () => {
    const providers = [provider({ id: "openrouter", hasKey: true }), provider({ id: "anthropic", hasKey: false }), provider({ id: "custom", hasKey: true })];
    expect(configuredProviders(providers).map((p) => p.id)).toEqual(["openrouter", "custom"]);
  });

  it("has a note for the provider that needs a typed model id", () => {
    expect(GOOSE_PROVIDERS.find((p) => p.id === "groq")?.note).toMatch(/Type the model id/);
  });
});

describe("the toasts", () => {
  it("say what happened", () => {
    expect(keySavedText(provider())).toMatch(/OpenRouter key saved/);
    expect(keyForgottenText(provider())).toMatch(/OpenRouter key removed/);
  });
});

describe("gooseBridge", () => {
  it("is null outside the desktop app", () => {
    expect(gooseBridge()).toBeNull();
  });
});
