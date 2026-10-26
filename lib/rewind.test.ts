import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// lib/rewind.ts reads a session's transcript from ~/.claude/projects. CLAUDE_CONFIG_DIR is read at
// import time, so the temp dir has to be in place before the import below.
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-rewind-"));
process.env.CLAUDE_CONFIG_DIR = configDir;

afterAll(() => fs.rmSync(configDir, { recursive: true, force: true }));

vi.mock("./import", () => ({
  sessionFiles: () => files,
}));

const files = new Map<string, string>();

const { sessionRewindPoint, sessionTip } = await import("./rewind");

// A transcript file in the sandbox's projects dir, so sessionFiles() finds it.
function writeSession(sessionId: string, lines: unknown[]) {
  const dir = path.join(configDir, "projects", "-Users-dev-weft");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n"));
  files.set(sessionId, file);
  return file;
}

beforeEach(() => {
  files.clear();
  fs.rmSync(path.join(configDir, "projects"), { recursive: true, force: true });
});

describe("sessionRewindPoint", () => {
  it("is the parent of the message in the session", () => {
    writeSession("s1", [{ uuid: "m1", parentUuid: "root" }]);
    expect(sessionRewindPoint("s1", "m1")).toBe("root");
  });

  it("is null when the message opened the session", () => {
    writeSession("s1", [{ uuid: "m1", parentUuid: null }]);
    expect(sessionRewindPoint("s1", "m1")).toBeNull();
  });

  it("is nothing when the message isn't in the session", () => {
    writeSession("s1", [{ uuid: "m1", parentUuid: "root" }]);
    expect(sessionRewindPoint("s1", "nope")).toBeUndefined();
  });

  it("is nothing when there is no session at all", () => {
    expect(sessionRewindPoint("nope", "m1")).toBeUndefined();
  });

  it("is nothing when the transcript can't be read", () => {
    const file = writeSession("s1", [{ uuid: "m1" }]);
    fs.rmSync(file);
    expect(sessionRewindPoint("s1", "m1")).toBeUndefined();
  });
});

describe("sessionTip", () => {
  it("is the uuid of the last assistant entry", () => {
    writeSession("s1", [
      { type: "user", uuid: "u1" },
      { type: "assistant", uuid: "a1" },
      { type: "user", uuid: "u2" },
      { type: "assistant", uuid: "a2" },
    ]);
    expect(sessionTip("s1")).toBe("a2");
  });

  it("is the last assistant entry, not the last entry", () => {
    writeSession("s1", [
      { type: "assistant", uuid: "a1" },
      { type: "user", uuid: "u2" },
    ]);
    expect(sessionTip("s1")).toBe("a1");
  });

  it("skips an assistant entry with no uuid", () => {
    writeSession("s1", [
      { type: "assistant", uuid: "a1" },
      { type: "assistant" },
      { type: "assistant", uuid: "a2" },
    ]);
    expect(sessionTip("s1")).toBe("a2");
  });

  it("is nothing when the session has no reply yet", () => {
    writeSession("s1", [{ type: "user", uuid: "u1" }]);
    expect(sessionTip("s1")).toBeUndefined();
  });

  it("is nothing when there is no session at all", () => {
    expect(sessionTip("nope")).toBeUndefined();
  });

  it("is nothing when the transcript can't be read", () => {
    const file = writeSession("s1", [{ type: "assistant", uuid: "a1" }]);
    fs.rmSync(file);
    expect(sessionTip("s1")).toBeUndefined();
  });

  it("is nothing when the last line isn't JSON", () => {
    writeSession("s1", [{ type: "assistant", uuid: "a1" }, "{not json"]);
    expect(sessionTip("s1")).toBeUndefined();
  });

  it("skips a broken line and finds the assistant entry before it", () => {
    writeSession("s1", ["{not json", { type: "assistant", uuid: "a1" }]);
    expect(sessionTip("s1")).toBe("a1");
  });

  it("reads the last entry of a transcript with no trailing newline", () => {
    writeSession("s1", [{ type: "user", uuid: "u1" }, { type: "assistant", uuid: "a1" }]);
    expect(sessionTip("s1")).toBe("a1");
  });

  it("is nothing for an empty transcript", () => {
    writeSession("s1", []);
    expect(sessionTip("s1")).toBeUndefined();
  });
});
