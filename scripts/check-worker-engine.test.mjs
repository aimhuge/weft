import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { engineMirror } from "./check-worker-engine.mjs";

const cli = fs.readFileSync(path.join(__dirname, "weft-worker.ts"), "utf8");

describe("engineMirror", () => {
  it("copies the worker CLI's imports and loadEngine(), with the helper it loads through", () => {
    const { modules, text } = engineMirror(cli);
    expect(modules).toBeGreaterThan(20);
    expect(text).toContain('import("../lib/store")');
    expect(text).toContain("async function inTurn");
    expect(text).toMatch(/export const loaded = loadEngine\(\);\n$/);
    expect(text).not.toContain("async function startCommand");
  });

  // jiti's async import hands a half-run module to a second import that races the first (PLUGIN_DIR undefined).
  it("loads the engine one module at a time, never in a Promise.all", () => {
    const loadEngine = engineMirror(cli).text.split("async function loadEngine()")[1];
    expect(loadEngine).not.toContain("Promise.all");
  });

  it("refuses a CLI without a loadEngine()", () => {
    expect(() => engineMirror('import x from "y";\n')).toThrow(/loadEngine/);
    expect(() => engineMirror("async function loadEngine() {\n  return 1;\n}\n")).toThrow(/no modules/);
  });
});
