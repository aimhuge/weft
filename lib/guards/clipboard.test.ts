import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLIPBOARD_REFUSED, PAIRING_OPEN_FILE } from "../clipboard-guard";
import { DATA_DIR } from "../store";
import { decide } from "./decide";
import { guardHooks } from "./hooks";

// The clipboard guard is in the one guard set every CLI runs (Claude Code in-process, Codex and Goose through decide()),
// and reads the marker Electron main writes while a pairing code is open (electron/pairing-open.cjs).
const marker = path.join(DATA_DIR, "vault", PAIRING_OPEN_FILE);
const pbpaste = { event: "PreToolUse" as const, tool: "Bash", input: { command: "pbpaste" }, cwd: "/tmp", id: "t1" };
const run = () => decide(guardHooks(() => 0, () => undefined), pbpaste, new AbortController().signal);

afterEach(() => fs.rmSync(marker, { force: true }));

describe("the guard set and an open pairing code", () => {
  it("refuses pbpaste while a code is open, and lets it run once it's gone or expired", async () => {
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, JSON.stringify({ until: Date.now() + 60_000 }));
    expect(await run()).toEqual({ decision: "deny", reason: CLIPBOARD_REFUSED });
    fs.writeFileSync(marker, JSON.stringify({ until: Date.now() - 1 }));
    expect((await run()).decision).toBe("allow");
    fs.rmSync(marker);
    expect((await run()).decision).toBe("allow");
  });
});
