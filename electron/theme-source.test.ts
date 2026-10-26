import { describe, expect, it, vi } from "vitest";
import { SCENES } from "../lib/theme";
import { BASES, followThemeChoice, themeSource } from "./theme-source.cjs";

describe("themeSource", () => {
  it("follows light and dark as saved", () => {
    expect(themeSource("light")).toBe("light");
    expect(themeSource("dark")).toBe("dark");
  });

  it("follows each scene's base palette, as the board lists them", () => {
    for (const s of SCENES) expect(themeSource(s.id)).toBe(s.base);
    expect(Object.keys(BASES).sort()).toEqual(["dark", "light", ...SCENES.map((s) => s.id)].sort());
  });

  it("follows the system for no cookie, system, or anything unknown", () => {
    expect(themeSource(undefined)).toBe("system");
    expect(themeSource("system")).toBe("system");
    expect(themeSource("toString")).toBe("system");
  });
});

const cookie = (value: unknown) => encodeURIComponent(JSON.stringify(value));

describe("themeSource for a prompted theme", () => {
  it("follows the base saved beside it", () => {
    expect(themeSource("custom-neon", cookie({ id: "neon", base: "light" }))).toBe("light");
    expect(themeSource("custom-neon", cookie({ id: "neon", base: "dark" }))).toBe("dark");
  });

  it("follows the system when its cookie is missing, stale or garbled", () => {
    expect(themeSource("custom-neon", undefined)).toBe("system");
    expect(themeSource("custom-neon", cookie({ id: "other", base: "dark" }))).toBe("system");
    expect(themeSource("custom-neon", cookie({ id: "neon", base: "sepia" }))).toBe("system");
    expect(themeSource("custom-neon", "%7Bnope")).toBe("system");
  });
});

describe("followThemeChoice", () => {
  type Listener = (e: unknown, cookie: { name: string; value: string }, cause: string, removed: boolean) => void;
  function jar(values: Record<string, string>) {
    let listener: Listener = () => {};
    const cookies = {
      get: vi.fn(({ name }: { name: string }) => Promise.resolve(name in values ? [{ value: values[name] }] : [])),
      on: vi.fn((_: string, fn: Listener) => (listener = fn)),
    };
    return { cookies, values, fire: (...args: Parameters<Listener>) => listener(...args) };
  }

  it("sets nativeTheme from the cookies now and whenever either changes", async () => {
    const { cookies, values, fire } = jar({ "weft-theme": "light" });
    const nativeTheme = { themeSource: "" };
    await followThemeChoice(cookies, nativeTheme);
    expect(nativeTheme.themeSource).toBe("light");

    values["weft-theme"] = "custom-neon";
    values["weft-custom-theme"] = encodeURIComponent(JSON.stringify({ id: "neon", base: "dark" }));
    fire(null, { name: "weft-custom-theme", value: "" }, "explicit", false);
    await vi.waitFor(() => expect(nativeTheme.themeSource).toBe("dark"));

    values["weft-theme"] = "light";
    fire(null, { name: "other", value: "" }, "explicit", false);
    fire(null, { name: "weft-theme", value: "" }, "overwrite", true);
    await Promise.resolve();
    expect(nativeTheme.themeSource).toBe("dark");
  });

  it("follows the system when the cookies can't be read", async () => {
    const cookies = { get: vi.fn(() => Promise.reject(new Error("closed"))), on: vi.fn() };
    const nativeTheme = { themeSource: "" };
    await followThemeChoice(cookies, nativeTheme);
    expect(nativeTheme.themeSource).toBe("system");
  });
});
