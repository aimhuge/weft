import { describe, expect, it, vi } from "vitest";

const { createDictationInsert, spaced, TEXT_ROLES, FOCUS_SCRIPT, PROBE_SCRIPT, WIN_PASTE } = await import("./dictation-insert.cjs");

type ExecCb = (err: Error | null, stdout?: string) => void;

interface Opts {
  focused?: boolean;
  contents?: unknown;
  trusted?: boolean;
  out?: string;
  execErr?: Error | null;
  mac?: boolean | undefined;
  win?: boolean;
}

function setup(opts: Opts = {}) {
  const { focused = false, contents, trusted = true, out = "pasted:AXTextArea", execErr = null } = opts;
  const mac = "mac" in opts ? opts.mac : true;
  const clipboard = { writeText: vi.fn() };
  const systemPreferences = { isTrustedAccessibilityClient: vi.fn<(prompt: boolean) => boolean>(() => trusted) };
  const BaseWindow = { getFocusedWindow: vi.fn(() => (focused ? {} : null)) };
  const webContents = { getFocusedWebContents: vi.fn(() => contents) };
  const execFile = vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: ExecCb) => cb(execErr, out));
  const deps = { clipboard, systemPreferences, BaseWindow, webContents, execFile };
  const deliver = createDictationInsert({ ...(mac === undefined ? deps : { ...deps, mac }), win: opts.win ?? false });
  return { deliver, clipboard, systemPreferences, execFile };
}

function page(probe: unknown, { destroyed = false, fail = false } = {}) {
  return {
    isDestroyed: () => destroyed,
    executeJavaScript: vi.fn(() => (fail ? Promise.reject(new Error("gone")) : Promise.resolve(probe))),
    insertText: vi.fn(),
  };
}

describe("spaced", () => {
  it("adds a space after a word character", () => expect(spaced("world", "o")).toBe(" world"));
  it("adds none after whitespace", () => expect(spaced("world", " ")).toBe("world"));
  it("adds none at the start of a field", () => {
    expect(spaced("world", "")).toBe("world");
    expect(spaced("world", undefined)).toBe("world");
  });
  it("adds none when the text already starts with a space", () => expect(spaced(" world", "o")).toBe(" world"));
});

describe("FOCUS_SCRIPT", () => {
  it("names every text role and pastes with ⌘V", () => {
    for (const role of TEXT_ROLES) expect(FOCUS_SCRIPT).toContain(`"${role}"`);
    expect(FOCUS_SCRIPT).toContain('keystroke "v" using command down');
  });
});

describe("deliver into Weft", () => {
  it("types into an editable field, with a space when it would run into a word", async () => {
    const contents = page({ editable: true, before: "o" });
    const { deliver, clipboard } = setup({ focused: true, contents });
    expect(await deliver("hi")).toBe("inserted");
    expect(clipboard.writeText).toHaveBeenCalledWith("hi");
    expect(contents.executeJavaScript).toHaveBeenCalledWith(PROBE_SCRIPT, true);
    expect(contents.insertText).toHaveBeenCalledWith(" hi");
  });
  it("types without a space after whitespace", async () => {
    const contents = page({ editable: true, before: " " });
    const { deliver } = setup({ focused: true, contents });
    expect(await deliver("hi")).toBe("inserted");
    expect(contents.insertText).toHaveBeenCalledWith("hi");
  });
  it("only copies when nothing editable has the caret", async () => {
    const contents = page({ editable: false });
    const { deliver, clipboard } = setup({ focused: true, contents });
    expect(await deliver("hi")).toBe("copied");
    expect(contents.insertText).not.toHaveBeenCalled();
    expect(clipboard.writeText).toHaveBeenCalledWith("hi");
  });
  it("only copies when the probe returns nothing", async () => {
    expect(await setup({ focused: true, contents: page(undefined) }).deliver("hi")).toBe("copied");
  });
  it("only copies when there are no focused contents, they're destroyed, or the probe throws", async () => {
    expect(await setup({ focused: true, contents: null }).deliver("hi")).toBe("copied");
    expect(await setup({ focused: true, contents: page({ editable: true }, { destroyed: true }) }).deliver("hi")).toBe("copied");
    const failing = page({ editable: true }, { fail: true });
    expect(await setup({ focused: true, contents: failing }).deliver("hi")).toBe("copied");
    expect(failing.insertText).not.toHaveBeenCalled();
  });
});

describe("deliver into another app", () => {
  it("asks for Accessibility once and reports no-access while untrusted", async () => {
    const { deliver, systemPreferences, execFile, clipboard } = setup({ trusted: false });
    expect(await deliver("hi")).toBe("no-access");
    expect(await deliver("hi")).toBe("no-access");
    expect(clipboard.writeText).toHaveBeenCalledTimes(2);
    const prompts = systemPreferences.isTrustedAccessibilityClient.mock.calls.filter(([p]) => p);
    expect(prompts).toHaveLength(1);
    expect(execFile).not.toHaveBeenCalled();
  });
  it("pastes into a text box", async () => {
    const { deliver, execFile } = setup({ out: "pasted:AXTextArea\n" });
    expect(await deliver("hi")).toBe("pasted");
    expect(execFile).toHaveBeenCalledWith("osascript", ["-e", FOCUS_SCRIPT], { timeout: 4000 }, expect.any(Function));
  });
  it("only copies when the focus takes no text", async () => {
    expect(await setup({ out: "none:AXWindow" }).deliver("hi")).toBe("copied");
  });
  it("only copies when osascript fails", async () => {
    expect(await setup({ execErr: new Error("timeout") }).deliver("hi")).toBe("copied");
  });
  it("only copies off macOS", async () => {
    const { deliver, execFile, systemPreferences } = setup({ mac: false });
    expect(await deliver("hi")).toBe("copied");
    expect(execFile).not.toHaveBeenCalled();
    expect(systemPreferences.isTrustedAccessibilityClient).not.toHaveBeenCalled();
  });
  it("defaults mac to the running platform", async () => {
    const { deliver, execFile } = setup({ mac: undefined });
    expect(await deliver("hi")).toBe(process.platform === "darwin" ? "pasted" : "copied");
    expect(execFile).toHaveBeenCalledTimes(process.platform === "darwin" ? 1 : 0);
  });
});

describe("Windows", () => {
  it("pastes into the focused app with Ctrl+V through a hidden PowerShell, after copying", async () => {
    const { deliver, execFile, clipboard, systemPreferences } = setup({ mac: false, win: true });
    expect(await deliver("hi")).toBe("pasted");
    expect(clipboard.writeText).toHaveBeenCalledWith("hi");
    expect(execFile).toHaveBeenCalledWith(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", WIN_PASTE],
      { timeout: 4000, windowsHide: true },
      expect.any(Function),
    );
    expect(WIN_PASTE).toContain("SendKeys('^v')");
    expect(systemPreferences.isTrustedAccessibilityClient).not.toHaveBeenCalled();
  });

  it("leaves the text on the clipboard when PowerShell fails", async () => {
    expect(await setup({ mac: false, win: true, execErr: new Error("blocked") }).deliver("hi")).toBe("copied");
  });

  it("still inserts straight into a Weft field", async () => {
    const contents = page({ editable: true, before: "" });
    const { deliver, execFile } = setup({ mac: false, win: true, focused: true, contents });
    expect(await deliver("hi")).toBe("inserted");
    expect(execFile).not.toHaveBeenCalled();
  });

  it("defaults win to the running platform", () => {
    const deps = { clipboard: { writeText() {} }, systemPreferences: {}, BaseWindow: {}, webContents: {}, execFile() {} };
    expect(typeof createDictationInsert(deps)).toBe("function");
  });
});
