// @vitest-environment jsdom
// Settings → Models → "Bring your own key": the provider list, saving and forgetting a key, and
// the endpoint field that only some providers need.
//
// The bridge (window.weft.goose) is the desktop app's IPC; here it is a fake that records what the
// section sends. The key the user types is sent once and never read back: the row clears its
// input after a save, so the board never holds it.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GooseProviderView } from "@/lib/goose-provider";
import "./test-utils";
import GooseProviderKey from "./GooseProviderKey";

const api = vi.hoisted(() => ({ saveSettings: vi.fn(() => Promise.resolve({})) }));
vi.mock("@/lib/client", () => ({ api }));

const listProviders = vi.fn();
const setProviderKey = vi.fn();
const forgetProviderKey = vi.fn();

function provider(over: Partial<GooseProviderView> = {}): GooseProviderView {
  return { id: "openrouter", label: "OpenRouter", envKey: "OPENROUTER_API_KEY", hasKey: false, models: ["anthropic/claude-sonnet-4.5"], ...over };
}

function installBridge(providers: GooseProviderView[] = [provider()]) {
  listProviders.mockResolvedValue({ providers });
  setProviderKey.mockResolvedValue(provider({ hasKey: true }));
  forgetProviderKey.mockResolvedValue({ id: "openrouter", removed: true });
  window.weft = { goose: { listProviders, setProviderKey, forgetProviderKey } } as unknown as typeof window.weft;
}

function setup(providerId = "openrouter") {
  render(<GooseProviderKey providerId={providerId} modelId="" baseUrl="" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.saveSettings.mockResolvedValue({});
  installBridge();
});

describe("GooseProviderKey", () => {
  it("lists every provider and says which one has a key saved", async () => {
    installBridge([provider(), provider({ id: "anthropic", label: "Anthropic", envKey: "ANTHROPIC_API_KEY", hasKey: true })]);
    setup();
    const picker = await screen.findByRole("combobox", { name: "Goose provider" });
    const options = Array.from((picker as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toHaveLength(14);
    expect(options[0]).toContain("OpenRouter");
    expect(options).toContain("Anthropic — key saved");
    // The saved provider is in the list of saved keys.
    expect(await screen.findByText("Anthropic")).toBeInTheDocument();
  });

  it("saves the key through the bridge and shows the saved state", async () => {
    setup();
    // A password input has no implicit ARIA role, so it's found by its label.
    const input = await screen.findByLabelText<HTMLInputElement>("OpenRouter API key");
    await userEvent.type(input, "sk-or-abc");
    await userEvent.click(screen.getByRole("button", { name: "Save the OpenRouter key" }));
    await waitFor(() => expect(setProviderKey).toHaveBeenCalledWith({ providerId: "openrouter", token: "sk-or-abc" }));
    expect(await screen.findByText(/OpenRouter key saved/)).toBeInTheDocument();
    // The key is gone from the board now.
    expect(screen.getByLabelText<HTMLInputElement>("OpenRouter API key").value).toBe("");
  });

  it("forgets a key through the bridge and clears the saved state", async () => {
    installBridge([provider({ hasKey: true })]);
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Forget the OpenRouter key" }));
    await waitFor(() => expect(forgetProviderKey).toHaveBeenCalledWith({ providerId: "openrouter" }));
    expect(await screen.findByText(/OpenRouter key removed/)).toBeInTheDocument();
  });

  it("shows the base URL only for the providers that need one", async () => {
    installBridge([
      provider({ id: "custom", label: "Custom (OpenAI-compatible)", envKey: "GOOSE_PROVIDER__API_KEY", models: [], hasKey: false }),
      provider({ id: "azure", label: "Azure OpenAI", envKey: "AZURE_OPENAI_API_KEY", models: [], hasKey: false }),
      provider({ id: "litellm", label: "LiteLLM", envKey: "LITELLM_API_KEY", models: [], hasKey: false }),
    ]);
    setup("openrouter");
    // The first provider on screen needs no endpoint.
    expect(screen.queryByRole("textbox", { name: /base URL/ })).not.toBeInTheDocument();

    const picker = await screen.findByRole("combobox", { name: "Goose provider" });
    await userEvent.selectOptions(picker, "custom");
    expect(await screen.findByRole("textbox", { name: "Custom (OpenAI-compatible) base URL" })).toBeInTheDocument();

    await userEvent.selectOptions(picker, "azure");
    expect(await screen.findByRole("textbox", { name: "Azure OpenAI base URL" })).toBeInTheDocument();

    await userEvent.selectOptions(picker, "litellm");
    expect(await screen.findByRole("textbox", { name: "LiteLLM base URL" })).toBeInTheDocument();
  });

  it("shows Anthropic's base URL too, so a gateway behind its API is reachable", async () => {
    installBridge([provider({ id: "anthropic", label: "Anthropic", envKey: "ANTHROPIC_API_KEY", models: [], hasKey: false })]);
    setup("anthropic");
    expect(await screen.findByRole("textbox", { name: "Anthropic base URL" })).toBeInTheDocument();
  });

  it("fills in Puku's provider, model and endpoint in one go", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Use Puku" }));
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith({
        gooseProviderId: "anthropic",
        gooseModelId: "puku-ai-2.8",
        gooseBaseUrl: "https://api-cli.puku.sh",
      }),
    );
  });

  it("saves the chosen provider and model into the settings", async () => {
    setup();
    const picker = await screen.findByRole("combobox", { name: "Goose provider" });
    await userEvent.selectOptions(picker, "anthropic");
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ gooseProviderId: "anthropic" }));
  });
});
