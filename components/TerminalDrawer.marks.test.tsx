// The terminal drawer is a full shell on the Mac with none of a thread's guards: it must carry data-human-only so
// board_view (electron/board-view.cjs) refuses to click or type in it. xterm can't render in jsdom, so this reads
// the markup; board-view.test.ts checks the gate also refuses an unmarked xterm.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "TerminalDrawer.tsx"), "utf8");

describe("TerminalDrawer human-only marks", () => {
  it("marks the drawer itself", () => {
    expect(source).toMatch(/<section data-human-only /);
  });

  it("marks the box xterm draws into, where its input textarea lives", () => {
    expect(source).toMatch(/<div ref=\{host\} data-human-only /);
  });
});
