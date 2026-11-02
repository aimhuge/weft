import fs from "node:fs";
import path from "node:path";
import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { DATA_DIR } from "./store";

// While a pairing code is open on this Mac (docs/architecture/mobile-security.md, "Pairing a passkey"), its link may sit
// on the clipboard (Copy link; lib/clipboard-briefly.ts clears it after a minute), and the link carries the pairing
// secret. A thread that read it could claim the code with its own key before the user's browser does. This PreToolUse
// hook turns away Bash commands that read the clipboard while a code is open: pbpaste, AppleScript's `the clipboard`,
// JXA's `theClipboard`, NSPasteboard from JXA, Swift or Python, pyperclip, clipboardy, and the X11/Wayland readers. Best-effort (a script written to a file first
// isn't seen); the code the page and Touch ID both show stays the real defence.
//
// Electron main is the only one who knows a code is open (electron/pairing.cjs), so it writes the latest expiry to
// vault/pairing-open.json in the data dir, which threads can neither read nor delete (lib/secret-guard-files.ts), and
// removes it when no code is left. The guard reads that file: one stat on a Bash call, no request to main.
export const PAIRING_OPEN_FILE = "pairing-open.json";

// Matched against the normalized line (below), so `pb''paste`, `p\bpaste` and `"the" clipboard` read as what they run.
const READS_CLIPBOARD = /pbpaste|the clipboard|clipboard as|clipboard info|get clipboard|theclipboard|pasteboard|\bpboard\b|wl-paste|xclip|xsel|pyperclip|clipboardy/;

// The line as a shell would mostly run it: $'' escapes, quotes, backticks and backslashes out, whitespace collapsed,
// lowercased. Best-effort: a word built from a variable, base64 or a script file still isn't seen.
export const normalizeCommand = (command: string) =>
  command.replace(/\$'/g, "").replace(/['"`\\]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

export const CLIPBOARD_REFUSED =
  "A pairing code is open on this Mac, and its link (which carries the pairing secret) may be on the clipboard, so Weft " +
  "doesn't let a thread read the clipboard until the code is used or cancelled (Settings → Sync). Ask the user to paste " +
  "what you need into the thread instead.";

// Whether a command line reads the clipboard.
export const readsClipboard = (command: string) => READS_CLIPBOARD.test(normalizeCommand(command));

// When the last open code expires (ms since epoch), or 0 when none is open.
export function pairingOpenUntil(dataDir = DATA_DIR): number {
  try {
    const until = (JSON.parse(fs.readFileSync(path.join(dataDir, "vault", PAIRING_OPEN_FILE), "utf8")) as { until?: unknown }).until;
    return typeof until === "number" && Number.isFinite(until) ? until : 0;
  } catch {
    return 0;
  }
}

export const pairingOpen = (now = Date.now(), dataDir = DATA_DIR) => pairingOpenUntil(dataDir) > now;

// Why a Bash command is turned away, or null to let it run.
export const clipboardVerdict = (command: string, open: boolean): string | null => (open && readsClipboard(command) ? CLIPBOARD_REFUSED : null);

export function clipboardGuard(open: () => boolean = () => pairingOpen()): HookCallback {
  return (input) => {
    if (input.hook_event_name !== "PreToolUse" || input.tool_name !== "Bash") return Promise.resolve({});
    const command = (input.tool_input as { command?: unknown } | undefined)?.command;
    // The file is read only for a command that reads the clipboard, so every other Bash call costs a regex.
    const why = typeof command === "string" && readsClipboard(command) ? clipboardVerdict(command, open()) : null;
    return Promise.resolve(why ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } } : {});
  };
}

// For PreToolUse, beside the restart guard (lib/guards/hooks.ts).
export function clipboardGuardMatcher(open?: () => boolean): HookCallbackMatcher {
  return { matcher: "Bash", hooks: [clipboardGuard(open)] };
}
