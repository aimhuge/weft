// @vitest-environment happy-dom
// lib/use-goose.ts: the provider list and the two actions that change it, through Electron main's
// bridge. The key goes out once and never comes back — what comes back is hasKey and the
// metadata beside it.
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GooseProviderView } from "./goose-provider";
import { useGooseProviders } from "./use-goose";

const listProviders = vi.fn();
const setProviderKey = vi.fn();
const forgetProviderKey = vi.fn();

function provider(over: Partial<GooseProviderView> = {}): GooseProviderView {
  return { id: "openrouter", label: "OpenRouter", envKey: "OPENROUTER_API_KEY", hasKey: false, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  listProviders.mockResolvedValue({ providers: [provider()] });
  setProviderKey.mockResolvedValue(provider({ hasKey: true }));
  forgetProviderKey.mockResolvedValue({ id: "openrouter", removed: true });
  window.weft = { goose: { listProviders, setProviderKey, forgetProviderKey } } as unknown as typeof window.weft;
});

afterEach(() => {
  cleanup();
  delete window.weft;
});

describe("useGooseProviders", () => {
  it("loads the providers when it mounts", async () => {
    const { result } = renderHook(() => useGooseProviders());
    await waitFor(() => expect(result.current.providers).toHaveLength(1));
    expect(result.current.providers[0]?.id).toBe("openrouter");
    expect(result.current.error).toBeNull();
  });

  it("saves a key with the provider, the token and the extras", async () => {
    const { result } = renderHook(() => useGooseProviders());
    await waitFor(() => expect(result.current.providers).toHaveLength(1));
    let ok = false;
    await act(async () => {
      ok = await result.current.setKey("openrouter", "sk-or-abc", { model: "gpt-4.1" });
    });
    expect(ok).toBe(true);
    expect(setProviderKey).toHaveBeenCalledWith({ providerId: "openrouter", token: "sk-or-abc", model: "gpt-4.1" });
  });

  it("forgets a key", async () => {
    const { result } = renderHook(() => useGooseProviders());
    await waitFor(() => expect(result.current.providers).toHaveLength(1));
    let ok = false;
    await act(async () => {
      ok = await result.current.forget("openrouter");
    });
    expect(ok).toBe(true);
    expect(forgetProviderKey).toHaveBeenCalledWith({ providerId: "openrouter" });
  });

  it("reports what went wrong", async () => {
    listProviders.mockRejectedValueOnce(new Error("main isn't ready"));
    const { result } = renderHook(() => useGooseProviders());
    await waitFor(() => expect(result.current.error).toBe("main isn't ready"));
  });

  it("does nothing outside the desktop app", async () => {
    delete window.weft;
    const { result } = renderHook(() => useGooseProviders());
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.providers).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});
