// The providers Goose can talk to, and the env each one reads (docs/architecture/goose.md).
//
// Goose reads a provider's key from the environment, uppercased, before it looks in its keyring: ANTHROPIC_API_KEY,
// OPENAI_API_KEY, OPENROUTER_API_KEY and so on. The generic override is GOOSE_PROVIDER__API_KEY, with
// GOOSE_PROVIDER__HOST for the base URL, which is how any OpenAI-compatible endpoint is configured.
//
// So a provider here is a name, the env var Goose reads, and the models it serves. The models are a short curated
// list where we know the ids for certain (OpenRouter's vendor/model ids); where we don't, the list is empty and the
// user types the model id — a wrong id is worse than none.
//
// CommonJS in electron/ because main can't import a .ts module and only electron/** ships in the packaged app.
// The board has its own copy of the catalog's shape in lib/goose-provider.ts; this file is the one main uses.

// A curated list of the models a provider serves. An empty list means "type the model id".
/**
 * @typedef {{ id: string, label: string, envKey: string, models: string[], note?: string, extraEnv?: Record<string, string>, freeModel?: boolean }} GooseProvider
 */

/** @type {GooseProvider[]} */
const GOOSE_PROVIDERS = [
  {
    id: "openrouter",
    label: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    models: [
      "anthropic/claude-sonnet-4.5",
      "anthropic/claude-opus-4.1",
      "openai/gpt-4.1",
      "google/gemini-2.5-pro",
      "qwen/qwen3-coder",
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    models: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
    // Anthropic's provider reads the host from ANTHROPIC_HOST, so a gateway that speaks the
    // Anthropic API (Puku's, for one) is reached by giving a base URL here. The host has no
    // "/v1": Goose appends "v1/messages" itself.
    extraEnv: { ANTHROPIC_HOST: "__baseUrl__" },
    // A gateway behind Anthropic's API serves its own model ids (puku-ai-2.8), so the id is typed.
    freeModel: true,
    note: "Type the model id, e.g. puku-ai-2.8 for Puku's gateway, or a Claude id.",
  },
  {
    id: "openai",
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    models: ["gpt-4.1", "gpt-4o", "o4-mini"],
  },
  {
    id: "google",
    label: "Google Gemini",
    envKey: "GOOGLE_API_KEY",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  {
    id: "groq",
    label: "Groq",
    envKey: "GROQ_API_KEY",
    models: [],
    note: "Type the model id, e.g. llama-3.3-70b-versatile",
  },
  {
    id: "mistral",
    label: "Mistral",
    envKey: "MISTRAL_API_KEY",
    models: ["mistral-large-latest", "mistral-small-latest", "codestral-latest"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "xai",
    label: "xAI",
    envKey: "XAI_API_KEY",
    models: ["grok-4", "grok-3"],
  },
  {
    id: "azure",
    label: "Azure OpenAI",
    envKey: "AZURE_OPENAI_API_KEY",
    models: [],
    note: "Needs an endpoint too (https://<resource>.openai.azure.com).",
    extraEnv: { AZURE_OPENAI_ENDPOINT: "__baseUrl__" },
  },
  {
    id: "litellm",
    label: "LiteLLM",
    envKey: "LITELLM_API_KEY",
    models: [],
    note: "Needs a host too (the LiteLLM proxy's address).",
    extraEnv: { LITELLM_HOST: "__baseUrl__" },
  },
  {
    id: "perplexity",
    label: "Perplexity",
    envKey: "PERPLEXITY_API_KEY",
    models: [],
    note: "Type the model id, e.g. sonar-pro",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    envKey: "CEREBRAS_API_KEY",
    models: [],
    note: "Type the model id, e.g. llama-3.3-70b",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    envKey: "OLLAMA_HOST",
    models: [],
    note: "No key needed — the host of your local Ollama, e.g. http://localhost:11434.",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    envKey: "GOOSE_PROVIDER__API_KEY",
    models: [],
    note: "Any OpenAI-compatible endpoint: it needs a base URL and a model id.",
  },
];

// The one provider whose key goes in the generic override, with the host beside it.
const CUSTOM = GOOSE_PROVIDERS.find((p) => p.id === "custom");

/** The provider with that id, or null. */
function providerById(id) {
  return GOOSE_PROVIDERS.find((p) => p.id === String(id ?? "")) ?? null;
}

/**
 * The env for a Goose subprocess: the provider's own variable, plus the extras it needs (a base URL for Azure,
 * LiteLLM and a custom endpoint). For a custom provider the key goes in GOOSE_PROVIDER__API_KEY and the base URL in
 * GOOSE_PROVIDER__HOST.
 *
 * @param {string} providerId
 * @param {string} token
 * @param {{ baseUrl?: string, model?: string }} [extra]
 * @returns {Record<string, string>}
 */
function envForProvider(providerId, token, extra = {}) {
  const provider = providerById(providerId);
  if (!provider) throw new Error(`Goose doesn't know a provider called "${providerId}".`);
  const value = String(token ?? "").trim();
  if (!value) throw new Error(`There's no ${provider.label} key saved.`);
  const env = { [provider.envKey]: value };
  const baseUrl = String(extra.baseUrl ?? "").trim();
  if (provider.id === "custom") {
    if (!baseUrl) throw new Error("A custom provider needs a base URL (the endpoint's address).");
    env.GOOSE_PROVIDER__HOST = baseUrl;
    return env;
  }
  // The extras name their variable with the base URL as a placeholder: only the ones that need one are added.
  for (const [name, placeholder] of Object.entries(provider.extraEnv ?? {})) {
    if (placeholder === "__baseUrl__" && baseUrl) env[name] = baseUrl;
  }
  return env;
}

// The model's id for a provider: what the user saved, or the first curated one.
function modelFor(providerId, extra = {}) {
  const saved = String(extra.model ?? "").trim();
  if (saved) return saved;
  return providerById(providerId)?.models[0] ?? "";
}

module.exports = { GOOSE_PROVIDERS, CUSTOM, providerById, envForProvider, modelFor };
