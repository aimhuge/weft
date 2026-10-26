import { describe, expect, it } from "vitest";
import { decodeThemeCookie, encodeThemeCookie, parseCustomTheme, safeCss, themeIdFrom, themeProperties } from "./custom-theme";

const COLORS = { canvas: "#0f141c", ink: "#e8edf5", accent: "rgb(95 208 238)" };

describe("safeCss", () => {
  it("keeps colors and gradients", () => {
    expect(safeCss(" #fff ")).toBe("#fff");
    expect(safeCss("linear-gradient(180deg, rgb(6 10 20 / 0.3), transparent 55%)")).toContain("linear-gradient");
  });

  it("refuses url(), anything that could end the rule, and non-strings", () => {
    expect(safeCss("url(http://x)")).toBeUndefined();
    expect(safeCss("red; } body { display: none")).toBeUndefined();
    expect(safeCss("<script>")).toBeUndefined();
    expect(safeCss(3)).toBeUndefined();
    expect(safeCss("")).toBeUndefined();
  });
});

describe("parseCustomTheme", () => {
  it("keeps the safe parts of a theme.json", () => {
    const t = parseCustomTheme(
      "neon-rain",
      { label: " Neon Rain ", base: "light", prompt: "rain", colors: { ...COLORS, "--muted": "#999", card: "url(x)" }, scrim: "linear-gradient(red, blue)", scenePos: "center 100%" },
      ["theme.json", "picture.svg"],
    );
    expect(t).toEqual({
      id: "neon-rain",
      label: "Neon Rain",
      base: "light",
      prompt: "rain",
      colors: { ...COLORS, muted: "#999" },
      scrim: "linear-gradient(red, blue)",
      scenePos: "center 100%",
      picture: "picture.svg",
    });
  });

  it("defaults the label, base and prompt, and leaves out what's missing", () => {
    expect(parseCustomTheme("x", { colors: COLORS })).toEqual({ id: "x", label: "x", base: "dark", prompt: "", colors: COLORS });
  });

  it("refuses a bad id, a non-object, or a palette missing canvas, ink or accent", () => {
    expect(parseCustomTheme("../etc", { colors: COLORS })).toBeNull();
    expect(parseCustomTheme("x", null)).toBeNull();
    expect(parseCustomTheme("x", { colors: { canvas: "#000" } })).toBeNull();
    expect(parseCustomTheme("x", { colors: "red" })).toBeNull();
  });
});

describe("themeProperties", () => {
  const theme = parseCustomTheme("x", { colors: COLORS })!;

  it("is a palette alone without a picture", () => {
    expect(themeProperties(theme)).toMatchObject({ "--canvas": "#0f141c", "--scene": "none" });
    expect(themeProperties(theme)["--scene-pos"]).toBeUndefined();
  });

  it("points at the theme's picture route when it has one", () => {
    const props = themeProperties({ ...theme, picture: "picture.jpg", scenePos: "center 90%", scrim: "linear-gradient(red, red)" });
    expect(props["--scene"]).toBe('url("/api/themes/x/picture")');
    expect(props["--scene-pos"]).toBe("center 90%");
    expect(props["--scrim"]).toBe("linear-gradient(red, red)");
  });
});

describe("theme cookie", () => {
  it("round-trips id, base and properties", () => {
    const theme = parseCustomTheme("x", { base: "light", colors: COLORS })!;
    const decoded = decodeThemeCookie(encodeThemeCookie(theme));
    expect(decoded).toMatchObject({ id: "x", base: "light" });
    expect(decoded?.props["--ink"]).toBe("#e8edf5");
  });

  it("is null when missing or garbled", () => {
    expect(decodeThemeCookie(undefined)).toBeNull();
    expect(decodeThemeCookie("%7Bnope")).toBeNull();
    expect(decodeThemeCookie(encodeURIComponent('{"id":1}'))).toBeNull();
  });
});

describe("themeIdFrom", () => {
  it("names the folder from the first words, numbering a taken one", () => {
    expect(themeIdFrom("A rainy Tokyo alley, at night!", () => false)).toBe("a-rainy-tokyo");
    const taken = new Set(["a-rainy-tokyo", "a-rainy-tokyo-2"]);
    expect(themeIdFrom("A rainy Tokyo", (id) => taken.has(id))).toBe("a-rainy-tokyo-3");
    expect(themeIdFrom("!!!", () => false)).toBe("theme");
  });
});
