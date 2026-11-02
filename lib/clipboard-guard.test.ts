import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLIPBOARD_REFUSED, clipboardGuard, clipboardGuardMatcher, clipboardVerdict, normalizeCommand, pairingOpen, pairingOpenUntil, PAIRING_OPEN_FILE, readsClipboard } from "./clipboard-guard";

const dataDir = (body?: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-clip-"));
  if (body !== undefined) {
    fs.mkdirSync(path.join(dir, "vault"));
    fs.writeFileSync(path.join(dir, "vault", PAIRING_OPEN_FILE), body);
  }
  return dir;
};

describe("readsClipboard", () => {
  it.each([
    "pbpaste",
    "pbpaste | head",
    "echo $(pbpaste)",
    "/usr/bin/pbpaste > /tmp/x",
    "sh -c 'pbpaste'",
    `osascript -e 'the clipboard as text'`,
    `osascript -e "get the clipboard"`,
    `osascript -e 'clipboard info'`,
    `osascript -l JavaScript -e 'ObjC.import("AppKit"); $.NSPasteboard.generalPasteboard.stringForType($.NSPasteboardTypeString)'`,
    `swift -e 'import AppKit; print(NSPasteboard.general.string(forType: .string)!)'`,
    `python3 -c "from AppKit import NSPasteboard"`,
    "wl-paste",
    "xclip -o -selection clipboard",
    "xsel --clipboard --output",
    // Spelled to slip past a plain match: quotes, backslashes, $'' and case.
    "pb''paste",
    'pb""paste',
    "p\\bpaste",
    "$'pbpaste'",
    "PBPASTE",
    "`which pbpaste`",
    `osascript -e 'the   "clipboard"'`,
    `osascript -e 'set x to (the clipboard as text)'`,
    `osascript -e 'get the clipboard'`,
    `osascript -l JavaScript -e 'Application.currentApplication().includeStandardAdditions = true; app.theClipboard()'`,
    `swift -e 'NSPasteboard.general'`,
    "pboard read",
    `python3 -c "import pyperclip; print(pyperclip.paste())"`,
    `node -e "require('clipboardy').readSync()"`,
  ])("reads: %s", (command) => {
    expect(readsClipboard(command)).toBe(true);
  });

  it.each(["ls", "git status", "pnpm test lib/clipboard-briefly.test.ts", "echo paste", "pbcopy < notes.txt", "pnpm test lib/clipboard-briefly.test.ts", "cat keyboard.md"])("leaves alone: %s", (command) => {
    expect(readsClipboard(command)).toBe(false);
  });
});

describe("normalizeCommand", () => {
  it("drops quotes, backslashes and $'' escapes, collapses whitespace and lowercases", () => {
    expect(normalizeCommand(`  $'PB'"pa"\\ste   \t 'X' `)).toBe("pbpaste x");
  });
});

describe("pairingOpen", () => {
  it("reads the expiry main marks, and treats anything else as closed", () => {
    expect(pairingOpenUntil(dataDir('{"until":2000}'))).toBe(2000);
    expect(pairingOpen(1999, dataDir('{"until":2000}'))).toBe(true);
    expect(pairingOpen(2000, dataDir('{"until":2000}'))).toBe(false);
    expect(pairingOpenUntil(dataDir())).toBe(0);
    expect(pairingOpenUntil(dataDir("not json"))).toBe(0);
    expect(pairingOpenUntil(dataDir('{"until":"2000"}'))).toBe(0);
    expect(pairingOpen()).toBe(false);
  });
});

describe("clipboardVerdict", () => {
  it("refuses a clipboard read only while a code is open", () => {
    expect(clipboardVerdict("pbpaste", true)).toBe(CLIPBOARD_REFUSED);
    expect(clipboardVerdict("pbpaste", false)).toBeNull();
    expect(clipboardVerdict("ls", true)).toBeNull();
  });
});

describe("clipboardGuard", () => {
  const call = (command: unknown, extra: Record<string, unknown> = {}) =>
    ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd: "/tmp", session_id: "s", transcript_path: "", ...extra }) as never;
  const opts = { signal: new AbortController().signal };

  it("denies pbpaste while a code is open, with the reason", async () => {
    const out = await clipboardGuard(() => true)(call("pbpaste"), undefined, opts);
    expect(out).toEqual({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: CLIPBOARD_REFUSED } });
    expect(CLIPBOARD_REFUSED).toMatch(/pairing code is open/);
  });

  it("lets it run once no code is open, and asks main nothing for other commands", async () => {
    let asked = 0;
    const open = () => {
      asked++;
      return false;
    };
    expect(await clipboardGuard(open)(call("pbpaste"), undefined, opts)).toEqual({});
    expect(await clipboardGuard(() => true)(call("ls"), undefined, opts)).toEqual({});
    expect(await clipboardGuard(open)(call(42), undefined, opts)).toEqual({});
    expect(asked).toBe(1);
  });

  it("only looks at Bash before it runs", async () => {
    expect(await clipboardGuard(() => true)(call("pbpaste", { tool_name: "Read" }), undefined, opts)).toEqual({});
    expect(await clipboardGuard(() => true)(call("pbpaste", { hook_event_name: "PostToolUse" }), undefined, opts)).toEqual({});
    expect(await clipboardGuard(() => true)({ hook_event_name: "PreToolUse", tool_name: "Bash", cwd: "/tmp" } as never, undefined, opts)).toEqual({});
  });

  it("matches Bash, reading main's marker by default", async () => {
    const m = clipboardGuardMatcher();
    expect(m.matcher).toBe("Bash");
    expect(await m.hooks[0]!(call("pbpaste"), undefined, opts)).toEqual({});
  });
});
