// @vitest-environment happy-dom
// lib/theme.ts with a theme you prompted up (lib/custom-theme.ts): read, applied and painted first.
import { runInThisContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CUSTOM_COOKIE, encodeThemeCookie, parseCustomTheme } from "./custom-theme";
import { applyTheme, DARK_QUERY, savedTheme, setCustomTheme, setTheme, THEME_COOKIE, THEME_SCRIPT } from "./theme";

const theme = parseCustomTheme("neon", { base: "light", colors: { canvas: "#101010", ink: "#fafafa", accent: "#ff00aa" } }, ["picture.jpg"])!;
const html = () => document.documentElement;

function systemDark(dark: boolean) {
  vi.stubGlobal("matchMedia", vi.fn((q: string) => ({ matches: q === DARK_QUERY && dark })));
}

beforeEach(() => {
  document.cookie = `${THEME_COOKIE}=; path=/; max-age=0`;
  document.cookie = `${CUSTOM_COOKIE}=; path=/; max-age=0`;
  delete html().dataset.theme;
  delete html().dataset.scene;
  html().removeAttribute("style");
  systemDark(true);
});
afterEach(() => vi.unstubAllGlobals());

describe("a prompted theme", () => {
  it("is saved as custom-<id> and painted from its own cookie", () => {
    setCustomTheme(theme);
    expect(savedTheme()).toBe("custom-neon");
    expect(html().dataset).toMatchObject({ theme: "light", scene: "custom" });
    expect(html().style.getPropertyValue("--accent")).toBe("#ff00aa");
    expect(html().style.getPropertyValue("--scene")).toContain("/api/themes/neon/picture");
  });

  it("clears its colors when another theme is picked", () => {
    setCustomTheme(theme);
    setTheme("dark");
    expect(html().dataset.scene).toBeUndefined();
    expect(html().dataset.theme).toBe("dark");
    expect(html().style.getPropertyValue("--accent")).toBe("");
    setTheme("light");
    expect(html().dataset.theme).toBe("light");
  });

  it("follows the system when its palette cookie is missing or for another theme", () => {
    document.cookie = `${THEME_COOKIE}=custom-gone; path=/`;
    applyTheme();
    expect(html().dataset.theme).toBe("dark");
    expect(html().dataset.scene).toBeUndefined();
    document.cookie = `${CUSTOM_COOKIE}=${encodeThemeCookie(theme)}; path=/`;
    applyTheme();
    expect(html().dataset.scene).toBeUndefined();
  });

  it("is painted by the head script before React runs", () => {
    document.cookie = `${CUSTOM_COOKIE}=${encodeThemeCookie(theme)}; path=/`;
    document.cookie = `${THEME_COOKIE}=custom-neon; path=/`;
    runInThisContext(THEME_SCRIPT);
    expect(html().dataset).toMatchObject({ theme: "light", scene: "custom" });
    expect(html().style.getPropertyValue("--canvas")).toBe("#101010");
  });

  it("falls back to the system in the head script when its cookie is stale", () => {
    document.cookie = `${CUSTOM_COOKIE}=${encodeThemeCookie(theme)}; path=/`;
    document.cookie = `${THEME_COOKIE}=custom-other; path=/`;
    runInThisContext(THEME_SCRIPT);
    expect(html().dataset.theme).toBe("dark");
    expect(html().dataset.scene).toBeUndefined();
  });
});
