import fs from "node:fs";
import path from "node:path";
import { isDictationLanguage } from "./dictation-languages";
import type { DictationPrefs } from "./dictation-types";
import { DATA_DIR } from "./store";

// Dictation's settings (Settings → General), kept in ~/.weft/dictation.json apart from settings.json:
// the language whisper listens for, Advanced dictation (the warm whisper-server, lib/whisper-server.ts)
// and your vocabulary, the names whisper should expect.

export type { DictationPrefs };

// whisper reads at most ~224 tokens of prompt; this keeps the list inside it.
export const VOCABULARY_MAX = 600;

export const DICTATION_FILE = path.join(DATA_DIR, "dictation.json");

const DEFAULTS: DictationPrefs = { language: "system", advanced: false, vocabulary: "" };

export function readDictationPrefs(): DictationPrefs {
  try {
    const raw = JSON.parse(fs.readFileSync(DICTATION_FILE, "utf8")) as Partial<DictationPrefs>;
    return {
      language: isDictationLanguage(raw.language) ? raw.language : DEFAULTS.language,
      advanced: raw.advanced === true,
      vocabulary: typeof raw.vocabulary === "string" ? raw.vocabulary.slice(0, VOCABULARY_MAX) : "",
    };
  } catch {
    return { ...DEFAULTS };
  }
}

// Checks the patch, writes the result and returns it.
export function writeDictationPrefs(patch: Record<string, unknown>): DictationPrefs {
  const next = readDictationPrefs();
  if (patch.language !== undefined) {
    if (!isDictationLanguage(patch.language)) throw new Error(`Dictation can't listen for ${JSON.stringify(patch.language)}.`);
    next.language = patch.language;
  }
  if (patch.advanced !== undefined) {
    if (typeof patch.advanced !== "boolean") throw new Error("advanced must be true or false.");
    next.advanced = patch.advanced;
  }
  if (patch.vocabulary !== undefined) {
    if (typeof patch.vocabulary !== "string") throw new Error("vocabulary must be text.");
    if (patch.vocabulary.length > VOCABULARY_MAX) throw new Error(`Keep the vocabulary under ${VOCABULARY_MAX} characters.`);
    next.vocabulary = patch.vocabulary;
  }
  fs.mkdirSync(path.dirname(DICTATION_FILE), { recursive: true });
  fs.writeFileSync(DICTATION_FILE, JSON.stringify(next, null, 2));
  return next;
}

// The vocabulary as whisper's initial prompt ("Weft, Supabase, tsc."), or "" for none.
export function vocabularyPrompt(vocabulary: string) {
  const terms = vocabulary
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter(Boolean);
  return terms.length ? `${terms.join(", ")}.` : "";
}
