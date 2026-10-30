// Dictation's shapes, shared by the server (lib/dictation-prefs.ts, lib/whisper-model.ts) and the
// Settings card. Client-safe: types only.

export interface DictationPrefs {
  // "system", "auto" or a whisper language code (lib/dictation-languages.ts).
  language: string;
  // Advanced dictation: the warm whisper-server (lib/whisper-server.ts).
  advanced: boolean;
  // Names and terms whisper should expect, one per line or comma-separated.
  vocabulary: string;
}

export interface DownloadState {
  downloading: boolean;
  received: number;
  total: number;
  error?: string;
}

export interface DictationSettingsView {
  prefs: DictationPrefs;
  // whisper-server is installed.
  server: boolean;
  // The turbo model the server would keep loaded, if it's on disk.
  model?: string;
  download: DownloadState;
}
