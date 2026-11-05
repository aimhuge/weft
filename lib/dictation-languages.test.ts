import { describe, expect, it } from "vitest";

import { DICTATION_LANGUAGES, isDictationLanguage, whisperLanguage } from "./dictation-languages";

// The language list is pure data: what the picker offers, and how a setting becomes whisper's `-l`.

describe("DICTATION_LANGUAGES", () => {
  it("offers the system language and detection first, then the codes", () => {
    expect(DICTATION_LANGUAGES[0]).toEqual({ id: "system", label: "System language" });
    expect(DICTATION_LANGUAGES[1]).toEqual({ id: "auto", label: "Detect each time (slower)" });
    expect(DICTATION_LANGUAGES.map((l) => l.id)).toContain("en");
    expect(DICTATION_LANGUAGES.map((l) => l.id)).toContain("zh");
  });

  it("has no duplicate ids and labels every one", () => {
    const ids = DICTATION_LANGUAGES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const language of DICTATION_LANGUAGES) expect(language.label).toBeTruthy();
  });

  it("only offers ids whisper understands", () => {
    for (const language of DICTATION_LANGUAGES) {
      if (language.id === "system" || language.id === "auto") continue;
      expect(isDictationLanguage(language.id)).toBe(true);
    }
  });
});

describe("isDictationLanguage", () => {
  it("takes the two special modes", () => {
    expect(isDictationLanguage("system")).toBe(true);
    expect(isDictationLanguage("auto")).toBe(true);
  });

  it("takes a whisper language code", () => {
    expect(isDictationLanguage("en")).toBe(true);
    expect(isDictationLanguage("zh")).toBe(true);
    expect(isDictationLanguage("uk")).toBe(true);
    expect(isDictationLanguage("yue")).toBe(true);
  });

  it("turns down a code whisper doesn't know", () => {
    expect(isDictationLanguage("klingon")).toBe(false);
    expect(isDictationLanguage("")).toBe(false);
    expect(isDictationLanguage("en-US")).toBe(false);
  });

  it("turns down anything that isn't a string", () => {
    expect(isDictationLanguage(undefined)).toBe(false);
    expect(isDictationLanguage(null)).toBe(false);
    expect(isDictationLanguage(42)).toBe(false);
    expect(isDictationLanguage({ id: "en" })).toBe(false);
  });
});

describe("whisperLanguage", () => {
  it("passes an explicit code through", () => {
    expect(whisperLanguage("en")).toBe("en");
    expect(whisperLanguage("fr")).toBe("fr");
  });

  it("passes 'auto' through", () => {
    expect(whisperLanguage("auto")).toBe("auto");
  });

  it("detects when the setting isn't a language at all", () => {
    expect(whisperLanguage("klingon")).toBe("auto");
    expect(whisperLanguage("")).toBe("auto");
  });

  it("uses the language the request names when the setting is 'system'", () => {
    expect(whisperLanguage("system", "de")).toBe("de");
    expect(whisperLanguage("system", "ja-JP")).toBe("ja");
    expect(whisperLanguage("system", "pt_BR")).toBe("pt");
  });

  it("lowercases and trims the requested language", () => {
    expect(whisperLanguage("system", "  IT  ")).toBe("it");
  });

  it("translates Norwegian Bokmål, which whisper calls 'no'", () => {
    expect(whisperLanguage("system", "nb")).toBe("no");
    expect(whisperLanguage("system", "nb-NO")).toBe("no");
  });

  it("falls back to English when the request names no language", () => {
    expect(whisperLanguage("system")).toBe("en");
    expect(whisperLanguage("system", null)).toBe("en");
    expect(whisperLanguage("system", "")).toBe("en");
    expect(whisperLanguage("system", "   ")).toBe("en");
  });

  it("detects when the request names a language whisper doesn't know", () => {
    expect(whisperLanguage("system", "klingon")).toBe("auto");
    expect(whisperLanguage("system", "xx-YY")).toBe("auto");
  });

  it("ignores the requested language when the setting isn't 'system'", () => {
    expect(whisperLanguage("en", "de")).toBe("en");
    expect(whisperLanguage("auto", "de")).toBe("auto");
  });
});
