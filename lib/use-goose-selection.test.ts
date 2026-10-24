// @vitest-environment happy-dom
// lib/use-goose-selection.ts: the chosen Goose provider, model and endpoint. Each is saved as it
// changes, and a field the server refuses goes back to what the server holds.
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ saveSettings: vi.fn() }));
vi.mock("./client", () => ({ api: { saveSettings: mocks.saveSettings } }));

import { useGooseSelection } from "./use-goose-selection";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveSettings.mockResolvedValue({});
});

afterEach(cleanup);

describe("useGooseSelection", () => {
  it("starts from the settings it was given", () => {
    const { result } = renderHook(() => useGooseSelection({ providerId: "openrouter", modelId: "gpt-4.1", baseUrl: "https://a.test" }));
    expect(result.current.providerId).toBe("openrouter");
    expect(result.current.modelId).toBe("gpt-4.1");
    expect(result.current.baseUrl).toBe("https://a.test");
  });

  it("saves the provider as it is picked", async () => {
    const { result } = renderHook(() => useGooseSelection({ providerId: "", modelId: "", baseUrl: "" }));
    act(() => result.current.setProvider("anthropic"));
    expect(result.current.providerId).toBe("anthropic");
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith({ gooseProviderId: "anthropic" }));
  });

  it("saves the model and the endpoint", async () => {
    const { result } = renderHook(() => useGooseSelection({ providerId: "custom", modelId: "", baseUrl: "" }));
    act(() => result.current.setModel("my-model"));
    act(() => result.current.setBaseUrl("https://api.example.com/v1"));
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith({ gooseModelId: "my-model" }));
    expect(mocks.saveSettings).toHaveBeenCalledWith({ gooseBaseUrl: "https://api.example.com/v1" });
  });

  it("puts the field back when the server refuses it", async () => {
    mocks.saveSettings.mockRejectedValueOnce(new Error("nope"));
    const { result } = renderHook(() => useGooseSelection({ providerId: "openrouter", modelId: "", baseUrl: "" }));
    act(() => result.current.setProvider("anthropic"));
    await waitFor(() => expect(result.current.error).toMatch(/Couldn’t save: nope/));
    expect(result.current.providerId).toBe("openrouter");
  });

  it("saves the provider, model and endpoint together in one save", async () => {
    const { result } = renderHook(() => useGooseSelection({ providerId: "openrouter", modelId: "", baseUrl: "" }));
    act(() => result.current.setAll({ providerId: "anthropic", modelId: "puku-ai-2.8", baseUrl: "https://api-cli.puku.sh" }));
    expect(result.current.providerId).toBe("anthropic");
    expect(result.current.modelId).toBe("puku-ai-2.8");
    expect(result.current.baseUrl).toBe("https://api-cli.puku.sh");
    await waitFor(() =>
      expect(mocks.saveSettings).toHaveBeenCalledWith({
        gooseProviderId: "anthropic",
        gooseModelId: "puku-ai-2.8",
        gooseBaseUrl: "https://api-cli.puku.sh",
      }),
    );
    // One save, not three: a preset is one choice.
    expect(mocks.saveSettings).toHaveBeenCalledTimes(1);
  });

  it("puts all three back when the server refuses them", async () => {
    mocks.saveSettings.mockRejectedValueOnce(new Error("nope"));
    const { result } = renderHook(() => useGooseSelection({ providerId: "openrouter", modelId: "gpt-4.1", baseUrl: "https://a.test" }));
    act(() => result.current.setAll({ providerId: "anthropic", modelId: "puku-ai-2.8", baseUrl: "https://api-cli.puku.sh" }));
    await waitFor(() => expect(result.current.error).toMatch(/Couldn’t save: nope/));
    expect(result.current.providerId).toBe("openrouter");
    expect(result.current.modelId).toBe("gpt-4.1");
    expect(result.current.baseUrl).toBe("https://a.test");
  });

  it("says which providers need an endpoint", () => {
    const { result } = renderHook(() => useGooseSelection({ providerId: "custom", modelId: "", baseUrl: "" }));
    expect(result.current.needsUrl).toBe(true);
  });

  it("doesn't need one for the rest", () => {
    const { result } = renderHook(() => useGooseSelection({ providerId: "openrouter", modelId: "", baseUrl: "" }));
    expect(result.current.needsUrl).toBe(false);
  });
});
