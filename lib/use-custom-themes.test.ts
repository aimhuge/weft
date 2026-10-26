// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCustomTheme, type CustomTheme } from "./custom-theme";

const themes = vi.hoisted(() => vi.fn());
vi.mock("./client", () => ({ api: { themes } }));
const theme = vi.hoisted(() => ({ savedTheme: vi.fn(() => "dark"), setCustomTheme: vi.fn() }));
vi.mock("./theme", () => theme);

import { THEME_POLL_MS, useCustomThemes } from "./use-custom-themes";

const make = (id: string) => parseCustomTheme(id, { colors: { canvas: "#000", ink: "#fff", accent: "#f0f" } })!;

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe("useCustomThemes", () => {
  it("loads the finished themes and refreshes the one you're on", async () => {
    themes.mockResolvedValue({ themes: [make("a"), make("b")] });
    theme.savedTheme.mockReturnValue("custom-b");
    const { result } = renderHook(() => useCustomThemes(vi.fn()));
    await waitFor(() => expect(result.current.themes).toHaveLength(2));
    expect(theme.setCustomTheme).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
  });

  it("keeps the list when loading fails", async () => {
    themes.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useCustomThemes(vi.fn()));
    await waitFor(() => expect(themes).toHaveBeenCalled());
    expect(result.current.themes).toEqual([]);
  });

  it("polls while a theme is being painted and hands it over when it lands", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    themes.mockResolvedValue({ themes: [] });
    const onArrive = vi.fn<(t: CustomTheme) => void>();
    const { result } = renderHook(() => useCustomThemes(onArrive));
    act(() => result.current.expect("new"));
    expect(result.current.pending).toEqual(["new"]);
    await act(() => vi.advanceTimersByTimeAsync(THEME_POLL_MS));
    expect(onArrive).not.toHaveBeenCalled();
    themes.mockResolvedValue({ themes: [make("new")] });
    await act(() => vi.advanceTimersByTimeAsync(THEME_POLL_MS));
    expect(onArrive).toHaveBeenCalledWith(expect.objectContaining({ id: "new" }));
    expect(result.current.pending).toEqual([]);
  });
});
