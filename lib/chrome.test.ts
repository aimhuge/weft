import { describe, expect, it } from "vitest";
import { CHROME_PROMPT, chromeArgs, reachesChrome } from "./chrome";

describe("the user's Chrome", () => {
  it("connects Claude in Chrome for Claude Code threads on the desktop", () => {
    expect(reachesChrome({ backend: "claude" }, false)).toBe(true);
    expect(chromeArgs({ backend: "claude" }, false)).toEqual({ chrome: null });
  });

  it("leaves it off for other CLIs, the copilot and Weft Workers", () => {
    expect(chromeArgs({ backend: "puku" }, false)).toBeUndefined();
    expect(chromeArgs({ backend: "codex" }, false)).toBeUndefined();
    expect(chromeArgs({ backend: "claude", copilot: true }, false)).toBeUndefined();
    expect(chromeArgs({ backend: "claude" }, true)).toBeUndefined();
  });

  it("tells a thread the pane comes first and Chrome is for sign-ins, with an AppleScript fallback", () => {
    expect(CHROME_PROMPT).toMatch(/pane by default/);
    expect(CHROME_PROMPT).toMatch(/sign-in the pane doesn't have/);
    expect(CHROME_PROMPT).toMatch(/osascript/);
    expect(CHROME_PROMPT).toMatch(/never tell the user you can't use their browser/);
  });
});
