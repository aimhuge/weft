// The temp data dir and fresh-module load the settings tests share (lib/settings.test.ts, lib/settings-folders.test.ts).
// Call withSettingsDir() at the top of a test file; load() re-imports ./settings with no cached state.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";

export const g = globalThis as unknown as { __weftState?: unknown; __weftSettings?: unknown };
export const settingsDir = { path: "" };

export async function load() {
  vi.resetModules();
  delete g.__weftState;
  delete g.__weftSettings;
  return import("./settings");
}

export function withSettingsDir() {
  beforeEach(() => {
    settingsDir.path = fs.mkdtempSync(path.join(os.tmpdir(), "weft-settings-"));
    process.env.WEFT_DATA = settingsDir.path;
  });
  afterEach(() => {
    delete g.__weftSettings;
    delete g.__weftState;
    fs.rmSync(settingsDir.path, { recursive: true, force: true });
  });
}
