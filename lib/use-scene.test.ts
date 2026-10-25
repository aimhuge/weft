// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { settingsBackdrop, useScene, useSettingsBackdrop } from "./use-scene";

afterEach(() => {
  document.documentElement.dataset.scene = "";
  document.documentElement.dataset.theme = "";
  document.documentElement.removeAttribute("style");
});

describe("useScene", () => {
  it("returns the current scene from the document", () => {
    document.documentElement.dataset.scene = "salt-flats";
    document.documentElement.dataset.theme = "light";
    const { result } = renderHook(() => useScene());
    expect(result.current.id).toBe("salt-flats");
  });

  it("follows a scene change", async () => {
    document.documentElement.dataset.scene = "salt-flats";
    document.documentElement.dataset.theme = "light";
    const { result } = renderHook(() => useScene());
    expect(result.current.id).toBe("salt-flats");
    act(() => {
      document.documentElement.dataset.scene = "twin-suns";
      document.documentElement.dataset.theme = "dark";
    });
    await waitFor(() => expect(result.current.id).toBe("twin-suns"));
  });
});

describe("settingsBackdrop", () => {
  it("paints a built-in scene's picture", () => {
    document.documentElement.dataset.scene = "cockpit";
    document.documentElement.dataset.theme = "dark";
    expect(settingsBackdrop()).toContain("url(/api/scenes/cockpit) center 62%");
  });

  it("paints a custom theme from its own properties, not a fallback scene", () => {
    document.documentElement.dataset.scene = "custom";
    document.documentElement.dataset.theme = "dark";
    const backdrop = settingsBackdrop();
    expect(backdrop).toContain("var(--scene) var(--scene-pos, center 62%) / cover no-repeat");
    expect(backdrop).not.toContain("/api/scenes/");
  });

  it("follows a pick from a scene to a custom theme", async () => {
    document.documentElement.dataset.scene = "twin-suns";
    document.documentElement.dataset.theme = "dark";
    const { result } = renderHook(() => useSettingsBackdrop());
    expect(result.current).toContain("/api/scenes/twin-suns");
    act(() => {
      document.documentElement.dataset.scene = "custom";
    });
    await waitFor(() => expect(result.current).toContain("var(--scene)"));
  });
});
