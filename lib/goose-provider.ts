// Goose's provider keys on the board's side (docs/architecture/goose.md).
//
// What the board knows about a provider: its name, the env var Goose reads its key from, whether a key is saved,
// and the non-secret metadata beside it (a custom endpoint, the model it serves). The key itself never reaches
// the board: Electron main keeps it in the Keychain and puts it in the Goose subprocess's env.
//
// The catalog here mirrors electron/goose-provider.cjs, which is the one Electron main uses. The board keeps its own
// copy because main can't import a .ts module and only electron/** ships in the packaged app.

// One provider in the catalog.
export interface GooseProviderView {
  id: string;
  label: string;
  // The env var Goose reads the key from, e.g. OPENROUTER_API_KEY.
  envKey: string;
  // Whether a key is saved for this provider. Never the key itself.
  hasKey: boolean;
  // A custom endpoint (an OpenAI-compatible base URL), when the provider needs one.
  baseUrl?: string;
  // The model the user picked for this provider.
  model?: string;
  // When the key was saved.
  savedAt?: string;
  // The models this provider is known to serve; empty means "type the model id".
  models?: string[];
  // True when the provider takes any model id, and the list is only a suggestion.
  freeModel?: boolean;
  // A note for the drawer: what the user still has to fill in.
  note?: string | null;
}

// What the board's Goose drawer draws.
export interface GooseProvidersView {
  providers: GooseProviderView[];
}

// window.weft.goose, from electron/preload.cjs.
export interface GooseBridge {
  listProviders(): Promise<GooseProvidersView>;
  setProviderKey(payload: { providerId: string; token: string; baseUrl?: string; model?: string }): Promise<GooseProviderView>;
  forgetProviderKey(payload: { providerId: string }): Promise<{ id: string; removed: boolean }>;
}

export function gooseBridge(): GooseBridge | null {
  return (typeof window !== "undefined" && window.weft?.goose) || null;
}

// Puku's gateway, as Goose reaches it: the Anthropic provider (the gateway speaks the Anthropic
// Messages API), the gateway's own host, and the model it serves. The host has no "/v1" — Goose
// appends "v1/messages" itself, so a host with it would ask for "/v1/v1/messages".
export const PUKU_GOOSE = {
  providerId: "anthropic",
  label: "Puku",
  baseUrl: "https://api-cli.puku.sh",
  modelId: "puku-ai-2.8",
} as const;

/**
 * Whether a Goose endpoint replaces the client's system prompt with its own. Puku's gateway does: a Goose turn
 * through it reports fewer input tokens than Goose's own prompt, and the model knows only Puku's identity. Known
 * by its host, or by a puku- model id when the endpoint is only saved beside the key.
 */
export function replacesSystemPrompt(baseUrl = "", model = ""): boolean {
  return /(^|\.)puku\.sh(\/|$|:)/.test(baseUrl.replace(/^https?:\/\//, "")) || /^puku-/i.test(model.trim());
}

// The catalog, as the board knows it. The same providers as electron/goose-provider.cjs, in the same order.
//
// extraEnv names the extra variable a provider needs beside its key; the base URL is written under
// that name when the user gave one. "__baseUrl__" is the placeholder that stands for it.
export interface GooseProviderEntry {
  id: string;
  label: string;
  envKey: string;
  models: string[];
  note?: string;
  extraEnv?: Record<string, string>;
  // True when the provider takes any model id and the list is only a suggestion.
  freeModel?: boolean;
}

export const GOOSE_PROVIDERS: GooseProviderEntry[] = [
  { id: "openrouter", label: "OpenRouter", envKey: "OPENROUTER_API_KEY", models: ["anthropic/claude-sonnet-4.5", "anthropic/claude-opus-4.1", "openai/gpt-4.1", "google/gemini-2.5-pro", "qwen/qwen3-coder"] },
  {
    id: "anthropic",
    label: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    models: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
    // Anthropic's provider reads the host from ANTHROPIC_HOST, so a gateway that speaks the
    // Anthropic API (Puku's, for one) is reached by giving a base URL here.
    extraEnv: { ANTHROPIC_HOST: "__baseUrl__" },
    // A gateway behind Anthropic's API serves its own model ids (puku-ai-2.8), so the id is typed.
    freeModel: true,
    note: "Type the model id, e.g. puku-ai-2.8 for Puku's gateway, or a Claude id.",
  },
  { id: "openai", label: "OpenAI", envKey: "OPENAI_API_KEY", models: ["gpt-4.1", "gpt-4o", "o4-mini"] },
  { id: "google", label: "Google Gemini", envKey: "GOOGLE_API_KEY", models: ["gemini-2.5-pro", "gemini-2.5-flash"] },
  { id: "groq", label: "Groq", envKey: "GROQ_API_KEY", models: [], note: "Type the model id, e.g. llama-3.3-70b-versatile" },
  { id: "mistral", label: "Mistral", envKey: "MISTRAL_API_KEY", models: ["mistral-large-latest", "mistral-small-latest", "codestral-latest"] },
  { id: "deepseek", label: "DeepSeek", envKey: "DEEPSEEK_API_KEY", models: ["deepseek-chat", "deepseek-reasoner"] },
  { id: "xai", label: "xAI", envKey: "XAI_API_KEY", models: ["grok-4", "grok-3"] },
  { id: "azure", label: "Azure OpenAI", envKey: "AZURE_OPENAI_API_KEY", models: [], note: "Needs an endpoint too (https://<resource>.openai.azure.com).", extraEnv: { AZURE_OPENAI_ENDPOINT: "__baseUrl__" } },
  { id: "litellm", label: "LiteLLM", envKey: "LITELLM_API_KEY", models: [], note: "Needs a host too (the LiteLLM proxy's address).", extraEnv: { LITELLM_HOST: "__baseUrl__" } },
  { id: "perplexity", label: "Perplexity", envKey: "PERPLEXITY_API_KEY", models: [], note: "Type the model id, e.g. sonar-pro" },
  { id: "cerebras", label: "Cerebras", envKey: "CEREBRAS_API_KEY", models: [], note: "Type the model id, e.g. llama-3.3-70b" },
  { id: "ollama", label: "Ollama (local)", envKey: "OLLAMA_HOST", models: [], note: "No key needed — the host of your local Ollama, e.g. http://localhost:11434." },
  { id: "custom", label: "Custom (OpenAI-compatible)", envKey: "GOOSE_PROVIDER__API_KEY", models: [], note: "Any OpenAI-compatible endpoint: it needs a base URL and a model id." },
];

/** The provider with that id, or null. */
export function providerById(id: string): (typeof GOOSE_PROVIDERS)[number] | null {
  return GOOSE_PROVIDERS.find((p) => p.id === id) ?? null;
}

/**
 * The env for a Goose subprocess: the provider's own variable, plus the extras it needs (a base URL for Azure,
 * LiteLLM and a custom endpoint). For a custom provider the key goes in GOOSE_PROVIDER__API_KEY and the base URL in
 * GOOSE_PROVIDER__HOST.
 *
 * This mirrors electron/goose-provider.cjs's envForProvider, so the board can show what will be set without ever
 * holding the key.
 */
export function gooseEnvFor(providerId: string, token: string, extra: { baseUrl?: string; model?: string } = {}): Record<string, string> {
  const provider = providerById(providerId);
  if (!provider) throw new Error(`Goose doesn't know a provider called "${providerId}".`);
  const value = token.trim();
  if (!value) throw new Error(`There's no ${provider.label} key saved.`);
  const env: Record<string, string> = { [provider.envKey]: value };
  const baseUrl = extra.baseUrl?.trim() ?? "";
  if (provider.id === "custom") {
    if (!baseUrl) throw new Error("A custom provider needs a base URL (the endpoint's address).");
    env.GOOSE_PROVIDER__HOST = baseUrl;
    return env;
  }
  // The extras name their variable with the base URL as a placeholder: only the ones that need one are added.
  // Azure's endpoint, LiteLLM's host and Anthropic's host all come from the catalog's table here.
  for (const [name, placeholder] of Object.entries(provider.extraEnv ?? {})) {
    if (placeholder === "__baseUrl__" && baseUrl) env[name] = baseUrl;
  }
  return env;
}

/** The model's id for a provider: what the user saved, else the first curated one, else "". */
export function gooseModelFor(providerId: string, extra: { model?: string } = {}): string {
  const saved = extra.model?.trim() ?? "";
  if (saved) return saved;
  return providerById(providerId)?.models[0] ?? "";
}

/** Whether a provider needs a base URL before it can be used. */
export function needsBaseUrl(providerId: string): boolean {
  return providerId === "custom" || providerId === "azure" || providerId === "litellm" || providerId === "anthropic";
}

/** The drawer row for a provider: hasKey is false and the metadata empty until a key is saved. */
export function providerRow(provider: GooseProviderView): GooseProviderView {
  return { ...provider, hasKey: provider.hasKey };
}

/** The providers with a key saved, in catalog order. */
export function configuredProviders(providers: GooseProviderView[]): GooseProviderView[] {
  return providers.filter((p) => p.hasKey).map(providerRow);
}

/** The Goose models a saved key serves: every curated model of each provider with a key. */
export function setUpGooseModels(providers: GooseProviderView[]): Set<string> {
  const keyed = new Set(providers.filter((p) => p.hasKey).map((p) => p.id));
  return new Set(GOOSE_PROVIDERS.filter((p) => keyed.has(p.id)).flatMap((p) => p.models));
}

/** The toast after a key is saved. */
export function keySavedText(provider: GooseProviderView): string {
  return `${provider.label} key saved. Weft keeps it in the Keychain and never shows it again.`;
}

/** The toast after a key is removed. */
export function keyForgottenText(provider: GooseProviderView): string {
  return `${provider.label} key removed from Weft.`;
}
