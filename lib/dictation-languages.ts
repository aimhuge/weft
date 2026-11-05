// The languages dictation can be set to (Settings → General). Client-safe: no node imports.

// What the picker offers. "system" follows the board's own language; "auto" lets whisper guess,
// which costs a second or two on every recording.
export const DICTATION_LANGUAGES: { id: string; label: string }[] = [
  { id: "system", label: "System language" },
  { id: "auto", label: "Detect each time (slower)" },
  { id: "en", label: "English" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "de", label: "German" },
  { id: "it", label: "Italian" },
  { id: "pt", label: "Portuguese" },
  { id: "nl", label: "Dutch" },
  { id: "ru", label: "Russian" },
  { id: "uk", label: "Ukrainian" },
  { id: "pl", label: "Polish" },
  { id: "tr", label: "Turkish" },
  { id: "ar", label: "Arabic" },
  { id: "he", label: "Hebrew" },
  { id: "hi", label: "Hindi" },
  { id: "th", label: "Thai" },
  { id: "vi", label: "Vietnamese" },
  { id: "id", label: "Indonesian" },
  { id: "ja", label: "Japanese" },
  { id: "ko", label: "Korean" },
  { id: "zh", label: "Chinese" },
];

// Every code whisper knows. A system language outside it falls back to detecting.
const WHISPER_CODES = new Set(
  "en zh de es ru ko fr ja pt tr pl ca nl ar sv it id hi fi vi he uk el ms cs ro da hu ta no th ur hr bg lt la mi ml cy sk te fa lv bn sr az sl kn et mk br eu is hy ne mn bs kk sq sw gl mr pa si km sn yo so af oc ka be tg sd gu am yi lo uz fo ht ps tk nn mt sa lb my bo tl mg as tt haw ln ha ba jw su yue".split(
    " ",
  ),
);

export function isDictationLanguage(value: unknown): value is string {
  return typeof value === "string" && (value === "system" || value === "auto" || WHISPER_CODES.has(value));
}

// The `-l` whisper gets: the setting, or for "system" the language the request names ("en-US" → "en").
export function whisperLanguage(setting: string, requested?: string | null): string {
  if (setting !== "system") return isDictationLanguage(setting) ? setting : "auto";
  const code = requested?.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  // Norwegian Bokmål is "nb" to a browser and "no" to whisper.
  const named = code === "nb" ? "no" : code;
  if (!named) return "en";
  return WHISPER_CODES.has(named) ? named : "auto";
}
