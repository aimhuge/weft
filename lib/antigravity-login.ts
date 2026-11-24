import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GOOGLE_ACCOUNT_WARNING } from "./antigravity-warning";
import { whichBin } from "./cli-exec";
import type { CliStatus } from "./types-settings";

// Antigravity's sign-in, the Weft side: where `agy` lives, whether it's signed in, how, and whether that sign-in is
// one Google says not to wrap. The runner itself is lib/antigravity-runner.ts.

export const AGY = "agy";

// `agy -p /usage --output-format json`: signed in, one JSON object with "status": "SUCCESS" and the plan's usage;
// signed out, a non-zero exit with "authentication required". It is the cheapest headless call that needs a sign-in.
export const ANTIGRAVITY_STATUS_ARGS = ["-p", "/usage", "--output-format", "json"];

// Google's installer puts agy in ~/.local/bin, which an app launched from the Dock may not have on its PATH.
export const ANTIGRAVITY_INSTALL = "curl -fsSL https://antigravity.google/cli/install.sh | bash";

/** Where agy is: on PATH, else in ~/.local/bin where Google's installer puts it, else null. */
export function antigravityBin(home = os.homedir(), which: (name: string) => string | null = whichBin): string | null {
  const found = which(AGY);
  if (found) return found;
  const local = path.join(home, ".local", "bin", AGY);
  return fs.existsSync(local) ? local : null;
}

/**
 * What Terminal runs to sign Antigravity in: `agy acp --login` (it signs in with Google, then exits). With no agy
 * yet (bin undefined), it installs agy first and runs the copy the installer put in ~/.local/bin.
 */
export function antigravityLoginCommand(quotedBin?: string): string {
  return quotedBin ? `${quotedBin} acp --login` : `${ANTIGRAVITY_INSTALL} && ~/.local/bin/${AGY} acp --login`;
}

/** The JSON object in agy's output: from its first "{" to its last "}", or null. */
export function jsonIn(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    // From a "{" to a "}", it parses to an object or not at all.
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The sign-in `agy -p /usage --output-format json` reports, or null when its output says neither. */
export function parseAntigravityStatus(stdout: string, stderr: string): CliStatus | null {
  const data = jsonIn(stdout);
  if (data?.status === "SUCCESS") return { loggedIn: true };
  const error = typeof data?.error === "string" ? data.error : "";
  if (/authentication required/i.test(`${error}\n${stderr}\n${stdout}`)) return { loggedIn: false };
  return null;
}

export type AntigravityAuthMode = "api-key" | "cloud" | "google-account";

// Only the one key is read, and nothing of the file is ever printed: it can sit beside an API key.
function modelProvider(home: string): unknown {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(path.join(home, ".gemini", "antigravity-cli", "settings.json"), "utf8"));
    return data && typeof data === "object" ? (data as { modelProvider?: unknown }).modelProvider : undefined;
  } catch {
    return undefined;
  }
}

/** How agy signs in: a Gemini API key, Google Cloud's application-default credentials, or a Google account. */
export function antigravityAuthMode(home = os.homedir(), env: Record<string, string | undefined> = process.env): AntigravityAuthMode {
  if (modelProvider(home) === "gemini") return "api-key";
  if (env.AGY_ADC_AUTH === "true") return "cloud";
  return "google-account";
}

/** The caution to show under Antigravity's login row, or undefined when its sign-in is one Google allows wrapping. */
export function antigravityWarning(mode: AntigravityAuthMode): string | undefined {
  return mode === "google-account" ? GOOGLE_ACCOUNT_WARNING : undefined;
}
