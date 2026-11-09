// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setUiLanguage, uiText, useUiLanguage, useUiText } from "./ui-language";

const browserLanguage = (language: string) => vi.spyOn(navigator, "language", "get").mockReturnValue(language);
const saveCookie = (value: string) => (document.cookie = `weft-ui-language=${value}; path=/`);
const clearCookie = () => (document.cookie = "weft-ui-language=; path=/; max-age=0");

afterEach(() => {
  clearCookie();
  vi.restoreAllMocks();
});

describe("useUiLanguage", () => {
  it("reads a saved choice from the cookie, whatever the browser says", () => {
    browserLanguage("en-US");
    document.cookie = "other=1; path=/";
    saveCookie("zh-CN");
    expect(renderHook(() => useUiLanguage()).result.current).toBe("zh-CN");
    browserLanguage("zh-CN");
    saveCookie("en");
    expect(renderHook(() => useUiLanguage()).result.current).toBe("en");
  });

  it("ignores a cookie it doesn't know and falls back to the browser", () => {
    saveCookie("fr");
    browserLanguage("en-GB");
    expect(renderHook(() => useUiLanguage()).result.current).toBe("en");
    saveCookie("zh-CNx");
    browserLanguage("zh-CN");
    expect(renderHook(() => useUiLanguage()).result.current).toBe("zh-CN");
  });

  it("takes Simplified Chinese locales to Chinese and leaves Traditional ones in English", () => {
    for (const lang of ["zh", "zh-CN", "zh-cn", "zh-SG", "zh-Hans", "zh-Hans-CN"]) {
      browserLanguage(lang);
      expect(renderHook(() => useUiLanguage()).result.current, lang).toBe("zh-CN");
    }
    for (const lang of ["zh-TW", "zh-HK", "zh-Hant", "zh-Hant-TW", "zh-CNX", "en", "ja-JP"]) {
      browserLanguage(lang);
      expect(renderHook(() => useUiLanguage()).result.current, lang).toBe("en");
    }
  });

  it("renders English on the server, before the browser can say", () => {
    function Probe() {
      return createElement("span", null, useUiLanguage());
    }
    browserLanguage("zh-CN");
    expect(renderToString(createElement(Probe))).toBe("<span>en</span>");
  });

  it("follows a change made with setUiLanguage", () => {
    browserLanguage("en-US");
    const { result } = renderHook(() => useUiLanguage());
    expect(result.current).toBe("en");
    act(() => setUiLanguage("zh-CN"));
    expect(result.current).toBe("zh-CN");
    act(() => setUiLanguage("en"));
    expect(result.current).toBe("en");
  });

  it("rechecks on a browser language change and on focus", () => {
    const lang = browserLanguage("en-US");
    const { result } = renderHook(() => useUiLanguage());
    lang.mockReturnValue("zh-CN");
    act(() => {
      window.dispatchEvent(new Event("languagechange"));
    });
    expect(result.current).toBe("zh-CN");
    act(() => {
      saveCookie("en");
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current).toBe("en");
  });

  it("stops listening once unmounted", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useUiLanguage());
    const events = ["weft-ui-language-change", "languagechange", "focus"];
    for (const e of events) expect(add).toHaveBeenCalledWith(e, expect.any(Function));
    unmount();
    for (const e of events) {
      const listener = add.mock.calls.find(([name]) => name === e)?.[1];
      expect(remove).toHaveBeenCalledWith(e, listener);
    }
  });
});

describe("setUiLanguage", () => {
  it("saves the choice in a cookie and tells listeners", () => {
    const heard = vi.fn();
    window.addEventListener("weft-ui-language-change", heard);
    setUiLanguage("zh-CN");
    expect(document.cookie).toContain("weft-ui-language=zh-CN");
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener("weft-ui-language-change", heard);
  });
});

describe("uiText", () => {
  it("translates known copy into Chinese and leaves English alone", () => {
    expect(uiText("zh-CN", "Settings")).toBe("设置");
    expect(uiText("en", "Settings")).toBe("Settings");
  });

  it("keeps text it has no translation for, including object keys", () => {
    expect(uiText("zh-CN", "Not a known string")).toBe("Not a known string");
    expect(uiText("zh-CN", "__proto__")).toBe("__proto__");
    expect(uiText("zh-CN", "constructor")).toBe("constructor");
    expect(uiText("zh-CN", "toString")).toBe("toString");
  });
});

describe("useUiText", () => {
  it("gives a translator for the current language", () => {
    browserLanguage("en-US");
    const { result } = renderHook(() => useUiText());
    expect(result.current("Settings")).toBe("Settings");
    act(() => setUiLanguage("zh-CN"));
    expect(result.current("Settings")).toBe("设置");
    expect(result.current("Not a known string")).toBe("Not a known string");
  });

  it("keeps the same function while the language stays", () => {
    const { result, rerender } = renderHook(() => useUiText());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
