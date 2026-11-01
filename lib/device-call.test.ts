// Local Simulator's wire format (lib/device-call.ts): the Mac reads a worker's call as untrusted input, so these tests
// pin what survives the read — the tool list, the fields each tool may have, and the build a call names.
import { describe, expect, it } from "vitest";
import { buildRef, callArgs, DEVICE_TOOLS, isDeviceTool, toolResultOf } from "./device-call";

const SHA = "a".repeat(64);

describe("isDeviceTool", () => {
  it("knows the tools a worker may call", () => {
    expect(DEVICE_TOOLS).toContain("install");
    expect(DEVICE_TOOLS).toContain("list_devices");
    expect(isDeviceTool("install")).toBe(true);
    expect(isDeviceTool("shell")).toBe(false);
    expect(isDeviceTool(undefined)).toBe(false);
    expect(isDeviceTool(42)).toBe(false);
  });
});

describe("buildRef", () => {
  it("reads a build that names its sha, kind and size", () => {
    expect(buildRef({ sha: SHA, kind: "apk", bytes: 12 })).toEqual({ sha: SHA, kind: "apk", bytes: 12 });
  });

  it("refuses a sha that isn't one, a kind it doesn't know, and no bytes", () => {
    expect(buildRef({ sha: "nope", kind: "apk", bytes: 12 })).toBeNull();
    expect(buildRef({ sha: SHA, kind: "dmg", bytes: 12 })).toBeNull();
    expect(buildRef({ sha: SHA, kind: "apk" })).toBeNull();
    expect(buildRef({ sha: SHA, kind: "apk", bytes: 0 })).toBeNull();
    expect(buildRef({ sha: SHA, kind: "apk", bytes: -1 })).toBeNull();
    expect(buildRef({ sha: SHA, kind: "apk", bytes: Number.NaN })).toBeNull();
    expect(buildRef({ sha: SHA, kind: "apk", bytes: "12" })).toBeNull();
    expect(buildRef(null)).toBeNull();
    expect(buildRef("nope")).toBeNull();
  });
});

describe("callArgs", () => {
  it("throws for a tool off the list", () => {
    expect(() => callArgs("shell", {})).toThrow("That tool can't reach this Mac.");
    expect(() => callArgs(undefined, {})).toThrow("That tool can't reach this Mac.");
  });

  it("throws for an install that names no build", () => {
    expect(() => callArgs("install", {})).toThrow("That install names no build.");
    expect(() => callArgs("install", { build: { sha: "bad", kind: "apk", bytes: 1 } })).toThrow("That install names no build.");
    expect(() => callArgs("install", { build: { sha: SHA, kind: "dmg", bytes: 1 } })).toThrow("That install names no build.");
    expect(() => callArgs("install", { build: { sha: SHA, kind: "apk", bytes: 0 } })).toThrow("That install names no build.");
  });

  it("gives an install its build and nothing else", () => {
    expect(callArgs("install", { build: { sha: SHA, kind: "app", bytes: 5 }, device: "other", path: "/tmp/x" })).toEqual({
      tool: "install",
      args: { build: { sha: SHA, kind: "app", bytes: 5 } },
    });
  });

  it("never lets a device, a path or a save_to through", () => {
    for (const tool of DEVICE_TOOLS) {
      const raw = { device: "d", path: "/etc/passwd", save_to: "/tmp/x.png", build: { sha: SHA, kind: "app", bytes: 5 } };
      const args = callArgs(tool, raw).args as Record<string, unknown>;
      expect(args).not.toHaveProperty("device");
      expect(args).not.toHaveProperty("path");
      expect(args).not.toHaveProperty("save_to");
    }
  });

  it("keeps only the fields a tool may have, each the type it must be", () => {
    expect(callArgs("tap", { element: "Login", x: 1, y: 2, extra: "no" }).args).toEqual({ element: "Login", x: 1, y: 2 });
    expect(callArgs("tap", { element: "Login", x: "1", y: 2 }).args).toEqual({ element: "Login", y: 2 });
    expect(callArgs("launch", { app: "com.x", device: "d" }).args).toEqual({ app: "com.x" });
    expect(callArgs("open_url", { url: "https://x.test" }).args).toEqual({ url: "https://x.test" });
    expect(callArgs("swipe", { direction: "up", from_x: 0, from_y: 0, to_x: 1, to_y: 1 }).args).toEqual({ direction: "up", from_x: 0, from_y: 0, to_x: 1, to_y: 1 });
    expect(callArgs("swipe", { direction: "sideways" }).args).toEqual({});
    expect(callArgs("type_text", { text: "hi", element: "Field" }).args).toEqual({ text: "hi", element: "Field" });
    expect(callArgs("type_text", { text: 42 }).args).toEqual({});
    expect(callArgs("logs", { app: "X", lines: 10, since: "2m" }).args).toEqual({ app: "X", lines: 10, since: "2m" });
    expect(callArgs("logs", { since: "2x" }).args).toEqual({});
    expect(callArgs("boot", { anything: 1 }).args).toEqual({});
  });

  it("keeps a press key off the list out", () => {
    expect(callArgs("press", { key: "home" }).args).toEqual({ key: "home" });
    expect(callArgs("press", { key: "power" }).args).toEqual({});
  });

  it("reads a call whose args aren't an object as empty", () => {
    expect(callArgs("tap", null).args).toEqual({});
    expect(callArgs("tap", "nope").args).toEqual({});
  });
});

describe("toolResultOf", () => {
  it("keeps text and image content and drops anything else", () => {
    expect(
      toolResultOf({
        content: [
          { type: "text", text: "hello" },
          { type: "image", data: "AAA", mimeType: "image/png" },
          { type: "video", data: "AAA" },
          { type: "text", text: 42 },
          { type: "image", data: "AAA" },
          "nope",
        ],
      }),
    ).toEqual({
      content: [
        { type: "text", text: "hello" },
        { type: "image", data: "AAA", mimeType: "image/png" },
      ],
    });
  });

  it("keeps isError only when it is true", () => {
    expect(toolResultOf({ content: [], isError: true })).toEqual({ content: [], isError: true });
    expect(toolResultOf({ content: [], isError: false })).toEqual({ content: [] });
    expect(toolResultOf({ content: [], isError: "yes" })).toEqual({ content: [] });
    expect(toolResultOf({ content: [] })).toEqual({ content: [] });
    expect(toolResultOf(null)).toEqual({ content: [] });
    expect(toolResultOf({ content: "nope" })).toEqual({ content: [] });
  });
});
