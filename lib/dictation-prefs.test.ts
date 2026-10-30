import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/store.ts reads WEFT_DATA once at import, so each test points it at a fresh temp dir and re-imports.
let dir: string;

async function load() {
  vi.resetModules();
  return import("./dictation-prefs");
}

const write = (data: unknown) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "dictation.json"), typeof data === "string" ? data : JSON.stringify(data));
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-dictation-prefs-"));
  process.env.WEFT_DATA = dir;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("readDictationPrefs", () => {
  it("gives the defaults when there's no file yet", async () => {
    const { readDictationPrefs } = await load();
    expect(readDictationPrefs()).toEqual({ language: "system", advanced: false, vocabulary: "" });
  });

  it("gives the defaults when the file is broken", async () => {
    write("{ not json");
    const { readDictationPrefs } = await load();
    expect(readDictationPrefs()).toEqual({ language: "system", advanced: false, vocabulary: "" });
  });

  it("reads what's stored", async () => {
    write({ language: "de", advanced: true, vocabulary: "Weft, Supabase" });
    const { readDictationPrefs } = await load();
    expect(readDictationPrefs()).toEqual({ language: "de", advanced: true, vocabulary: "Weft, Supabase" });
  });

  it("falls back to the default language when the stored one is unknown", async () => {
    write({ language: "klingon", advanced: true, vocabulary: "x" });
    const { readDictationPrefs } = await load();
    expect(readDictationPrefs().language).toBe("system");
  });

  it("takes 'system' and 'auto' as languages", async () => {
    write({ language: "auto", advanced: false, vocabulary: "" });
    const { readDictationPrefs } = await load();
    expect(readDictationPrefs().language).toBe("auto");
  });

  it("only treats advanced as on when it's exactly true", async () => {
    write({ language: "en", advanced: "yes", vocabulary: "" });
    const { readDictationPrefs } = await load();
    expect(readDictationPrefs().advanced).toBe(false);
  });

  it("only keeps a vocabulary that's text", async () => {
    write({ language: "en", advanced: false, vocabulary: 42 });
    const { readDictationPrefs } = await load();
    expect(readDictationPrefs().vocabulary).toBe("");
  });

  it("cuts a vocabulary that's too long", async () => {
    const { readDictationPrefs, VOCABULARY_MAX } = await load();
    write({ language: "en", advanced: false, vocabulary: "a".repeat(VOCABULARY_MAX + 50) });
    expect(readDictationPrefs().vocabulary).toHaveLength(VOCABULARY_MAX);
  });
});

describe("writeDictationPrefs", () => {
  it("writes the file and gives back what it wrote", async () => {
    const { writeDictationPrefs, DICTATION_FILE } = await load();
    const prefs = writeDictationPrefs({ language: "fr", advanced: true, vocabulary: "Weft" });
    expect(prefs).toEqual({ language: "fr", advanced: true, vocabulary: "Weft" });
    expect(DICTATION_FILE).toBe(path.join(dir, "dictation.json"));
    expect(JSON.parse(fs.readFileSync(DICTATION_FILE, "utf8"))).toEqual({ language: "fr", advanced: true, vocabulary: "Weft" });
  });

  it("keeps the settings it isn't given", async () => {
    const { writeDictationPrefs, readDictationPrefs } = await load();
    writeDictationPrefs({ language: "de", advanced: true, vocabulary: "Weft" });
    expect(writeDictationPrefs({ vocabulary: "tsc" })).toEqual({ language: "de", advanced: true, vocabulary: "tsc" });
    expect(readDictationPrefs().language).toBe("de");
  });

  it("turns advanced off", async () => {
    const { writeDictationPrefs } = await load();
    writeDictationPrefs({ advanced: true });
    expect(writeDictationPrefs({ advanced: false }).advanced).toBe(false);
  });

  it("writes into a data dir that doesn't exist yet", async () => {
    process.env.WEFT_DATA = path.join(dir, "deeper", "data");
    const { writeDictationPrefs } = await load();
    writeDictationPrefs({ vocabulary: "Weft" });
    expect(fs.existsSync(path.join(dir, "deeper", "data", "dictation.json"))).toBe(true);
  });

  it("turns down a language whisper doesn't know", async () => {
    const { writeDictationPrefs } = await load();
    expect(() => writeDictationPrefs({ language: "klingon" })).toThrow("Dictation can't listen for \"klingon\".");
  });

  it("turns down an advanced that isn't true or false", async () => {
    const { writeDictationPrefs } = await load();
    expect(() => writeDictationPrefs({ advanced: "yes" })).toThrow("advanced must be true or false.");
  });

  it("turns down a vocabulary that isn't text", async () => {
    const { writeDictationPrefs } = await load();
    expect(() => writeDictationPrefs({ vocabulary: 42 })).toThrow("vocabulary must be text.");
  });

  it("turns down a vocabulary that's too long", async () => {
    const { writeDictationPrefs, VOCABULARY_MAX } = await load();
    expect(() => writeDictationPrefs({ vocabulary: "a".repeat(VOCABULARY_MAX + 1) })).toThrow(
      `Keep the vocabulary under ${VOCABULARY_MAX} characters.`,
    );
  });

  it("writes nothing when the patch is turned down", async () => {
    const { writeDictationPrefs, DICTATION_FILE } = await load();
    expect(() => writeDictationPrefs({ language: "klingon" })).toThrow();
    expect(fs.existsSync(DICTATION_FILE)).toBe(false);
  });
});

describe("vocabularyPrompt", () => {
  it("turns a list of terms into whisper's prompt", async () => {
    const { vocabularyPrompt } = await load();
    expect(vocabularyPrompt("Weft, Supabase\ntsc")).toBe("Weft, Supabase, tsc.");
  });

  it("trims the terms and drops the empty ones", async () => {
    const { vocabularyPrompt } = await load();
    expect(vocabularyPrompt("  Weft  ,\n\n  tsc  ")).toBe("Weft, tsc.");
  });

  it("gives nothing for an empty vocabulary", async () => {
    const { vocabularyPrompt } = await load();
    expect(vocabularyPrompt("")).toBe("");
    expect(vocabularyPrompt("  ,  \n ")).toBe("");
  });
});
