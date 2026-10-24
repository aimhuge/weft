// What electron/goose-provider.cjs owes the Goose runner: the catalog's env vars are the ones Goose actually reads,
// and the env a provider gets is the one Goose looks for. The custom provider is the one with two variables.
import { describe, expect, it } from "vitest";
import { GOOSE_PROVIDERS, envForProvider, modelFor, providerById } from "./goose-provider.cjs";

describe("the catalog", () => {
  it("has a provider for every env var Goose reads", () => {
    const keys = GOOSE_PROVIDERS.map((p) => p.envKey);
    for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "GOOGLE_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "DEEPSEEK_API_KEY", "XAI_API_KEY", "GOOSE_PROVIDER__API_KEY"]) expect(keys).toContain(key);
  });

  it("has no two providers with the same id", () => {
    const ids = GOOSE_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no two providers with the same env var", () => {
    const keys = GOOSE_PROVIDERS.map((p) => p.envKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("leaves the model list empty where we don't know the ids, rather than inventing one", () => {
    expect(GOOSE_PROVIDERS.find((p) => p.id === "groq")?.models).toEqual([]);
    expect(GOOSE_PROVIDERS.find((p) => p.id === "groq")?.note).toMatch(/Type the model id/);
  });

  it("has OpenRouter's vendor/model ids", () => {
    expect(GOOSE_PROVIDERS.find((p) => p.id === "openrouter")?.models).toContain("anthropic/claude-sonnet-4.5");
  });
});

describe("providerById", () => {
  it("finds a provider, and is null for one that isn't there", () => {
    expect(providerById("custom")?.envKey).toBe("GOOSE_PROVIDER__API_KEY");
    expect(providerById("nope")).toBeNull();
  });
});

describe("envForProvider", () => {
  it("puts the key in the provider's own variable", () => {
    expect(envForProvider("openrouter", "sk-or-abc")).toEqual({ OPENROUTER_API_KEY: "sk-or-abc" });
    expect(envForProvider("openai", "sk-oai-abc")).toEqual({ OPENAI_API_KEY: "sk-oai-abc" });
  });

  it("puts a custom provider's key and host in the generic override", () => {
    expect(envForProvider("custom", "sk-custom", { baseUrl: "https://api.example.com/v1" })).toEqual({
      GOOSE_PROVIDER__API_KEY: "sk-custom",
      GOOSE_PROVIDER__HOST: "https://api.example.com/v1",
    });
  });

  it("needs a base URL for a custom provider", () => {
    expect(() => envForProvider("custom", "sk-custom")).toThrow(/needs a base URL/);
  });

  it("puts the endpoint beside the key for Azure and LiteLLM", () => {
    expect(envForProvider("azure", "az-abc", { baseUrl: "https://r.openai.azure.com" })).toEqual({ AZURE_OPENAI_API_KEY: "az-abc", AZURE_OPENAI_ENDPOINT: "https://r.openai.azure.com" });
    expect(envForProvider("litellm", "lit-abc", { baseUrl: "http://localhost:4000" })).toEqual({ LITELLM_API_KEY: "lit-abc", LITELLM_HOST: "http://localhost:4000" });
  });

  it("puts the host beside the key for Anthropic, so a gateway like Puku's is reached", () => {
    expect(envForProvider("anthropic", "sk-ant-abc", { baseUrl: "https://api-cli.puku.sh" })).toEqual({
      ANTHROPIC_API_KEY: "sk-ant-abc",
      ANTHROPIC_HOST: "https://api-cli.puku.sh",
    });
  });

  it("leaves Anthropic's host out when there is none", () => {
    expect(envForProvider("anthropic", "sk-ant-abc")).toEqual({ ANTHROPIC_API_KEY: "sk-ant-abc" });
  });

  it("leaves the endpoint out when there is none", () => {
    expect(envForProvider("azure", "az-abc")).toEqual({ AZURE_OPENAI_API_KEY: "az-abc" });
  });

  it("refuses a provider it doesn't know, and an empty key", () => {
    expect(() => envForProvider("nope", "abc")).toThrow(/doesn't know a provider called "nope"/);
    expect(() => envForProvider("openrouter", "  ")).toThrow(/no OpenRouter key saved/);
  });
});

describe("modelFor", () => {
  it("is what the user saved, else the first curated one, else empty", () => {
    expect(modelFor("openrouter", { model: "my-model" })).toBe("my-model");
    expect(modelFor("openrouter")).toBe("anthropic/claude-sonnet-4.5");
    expect(modelFor("groq")).toBe("");
  });
});
