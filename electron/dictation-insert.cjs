// Where a finished dictation goes (docs/architecture/dictation.md#anywhere). The text always lands on the clipboard
// first, so a paste that missed is one ⌘V away. Then:
// - Weft itself is the active app: the focused page says whether an input, textarea or editor has the caret, and the
//   text is typed straight in (webContents.insertText), with a space before it when it would run into a word.
// - Another app is active: macOS Accessibility gives the focused element's role. A text box gets ⌘V; anything else
//   (the desktop, a list, a button) keeps the text on the clipboard only.

// Roles that take typed text. A focused element with a selected-text range counts too (some editors report a plain
// AXGroup), see FOCUS_SCRIPT.
const TEXT_ROLES = new Set(["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"]);

// Asks the active app for its focused element and pastes when it takes text, in one osascript run (~100 ms). Chromium
// and Electron apps build their accessibility tree only when asked: AXManualAccessibility asks.
const FOCUS_SCRIPT = `
tell application "System Events"
  set p to first application process whose frontmost is true
  try
    set value of attribute "AXManualAccessibility" of p to true
  end try
  set r to ""
  set editable to false
  try
    set f to value of attribute "AXFocusedUIElement" of p
    set r to role of f
    try
      get value of attribute "AXSelectedTextRange" of f
      set editable to true
    end try
  end try
  if r is in {${[...TEXT_ROLES].map((role) => `"${role}"`).join(", ")}} or editable then
    keystroke "v" using command down
    return "pasted:" & r
  end if
  return "none:" & r
end tell`;

// Windows: Ctrl+V into whatever has focus, through a hidden PowerShell (WScript.Shell's SendKeys). Windows needs no
// Accessibility grant for it, and can't tell a text box from anything else the way macOS's AXFocusedUIElement can,
// so the text is always pasted; Ctrl+V where nothing takes text does nothing, and the clipboard still has it.
const WIN_PASTE = "(New-Object -ComObject WScript.Shell).SendKeys('^v')";

// Runs in the focused Weft page: whether the caret is in something that takes text, and whether the text needs a space
// in front so it doesn't run into the word before it.
const PROBE_SCRIPT = `(() => {
  const el = document.activeElement;
  if (!el || !document.hasFocus()) return { editable: false };
  const field = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|url|email|)$/.test(el.type));
  if (field) {
    const at = el.selectionStart ?? el.value.length;
    return { editable: !el.readOnly && !el.disabled, before: el.value.slice(Math.max(0, at - 1), at) };
  }
  if (!el.isContentEditable) return { editable: false };
  const sel = getSelection();
  const node = sel && sel.anchorNode;
  const before = node && node.nodeType === 3 ? node.textContent.slice(Math.max(0, sel.anchorOffset - 1), sel.anchorOffset) : "";
  return { editable: true, before };
})()`;

// The text with a leading space when the character before the caret is part of a word.
function spaced(text, before) {
  return before && !/\s/.test(before) && !/^\s/.test(text) ? ` ${text}` : text;
}

function createDictationInsert({
  clipboard, systemPreferences, BaseWindow, webContents, execFile, mac = process.platform === "darwin", win = process.platform === "win32",
}) {
  let askedForAccess = false;

  function runScript(script) {
    return new Promise((resolve) => {
      execFile("osascript", ["-e", script], { timeout: 4000 }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
    });
  }

  async function intoWeft(text) {
    const contents = webContents.getFocusedWebContents();
    if (!contents || contents.isDestroyed()) return null;
    let probe;
    try {
      probe = await contents.executeJavaScript(PROBE_SCRIPT, true);
    } catch {
      return null;
    }
    if (!probe?.editable) return "copied";
    contents.insertText(spaced(text, probe.before));
    return "inserted";
  }

  function pasteOnWindows() {
    const args = ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", WIN_PASTE];
    return new Promise((resolve) => {
      execFile("powershell.exe", args, { timeout: 4000, windowsHide: true }, (err) => resolve(err ? "copied" : "pasted"));
    });
  }

  async function intoOtherApp() {
    if (win) return pasteOnWindows();
    if (!mac) return "copied";
    if (!systemPreferences.isTrustedAccessibilityClient(false)) {
      // macOS shows its own "allow Accessibility" prompt, once a launch; until then the clipboard does the job.
      if (!askedForAccess) systemPreferences.isTrustedAccessibilityClient(true);
      askedForAccess = true;
      return "no-access";
    }
    const out = await runScript(FOCUS_SCRIPT);
    return out?.startsWith("pasted:") ? "pasted" : "copied";
  }

  // Resolves to how the text arrived: "inserted" (a Weft field), "pasted" (another app's text box), "copied" (no text
  // box) or "no-access" (copied; Weft needs Accessibility to paste).
  return async function deliver(text) {
    clipboard.writeText(text);
    if (BaseWindow.getFocusedWindow()) return (await intoWeft(text)) ?? "copied";
    return intoOtherApp();
  };
}

module.exports = { createDictationInsert, spaced, TEXT_ROLES, FOCUS_SCRIPT, PROBE_SCRIPT, WIN_PASTE };
