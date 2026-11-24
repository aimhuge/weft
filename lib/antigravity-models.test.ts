import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ~/.weft/antigravity-models.json: the models agy's session/new and session/load said this account may use.

let dir = "";

async function load() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__weftAgyModels;
  return import("./antigravity-models");
}

const file = () => path.join(dir, "antigravity-models.json");

const ANSWER = {
  availableModels: [
    { modelId: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
    { modelId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
    { modelId: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
  ],
  currentModelId: "gemini-3.8-flash-high",
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-agy-models-"));
  process.env.WEFT_DATA = dir;
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("parseAgyModels", () => {
  it("reads each { modelId, name } as { id, label }", async () => {
    const { parseAgyModels } = await load();
    expect(parseAgyModels(ANSWER)).toEqual([
      { id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Thinking)" },
      { id: "gpt-oss-120b-medium", label: "GPT-OSS 120B (Medium)" },
    ]);
  });

  it("drops entries with no id and repeats, and labels a nameless model by its id", async () => {
    const { parseAgyModels } = await load();
    const models = { availableModels: [null, 7, { name: "No id" }, { modelId: "  " }, { modelId: " a ", name: 3 }, { modelId: "a", name: "Again" }, { modelId: "b", name: " B " }] };
    expect(parseAgyModels(models)).toEqual([
      { id: "a", label: "a" },
      { id: "b", label: "B" },
    ]);
  });

  it("is null for anything that isn't a list of models, or an empty one", async () => {
    const { parseAgyModels } = await load();
    for (const bad of [undefined, null, "x", {}, { availableModels: "x" }, { availableModels: [] }, { availableModels: [{}] }]) {
      expect(parseAgyModels(bad)).toBeNull();
    }
  });
});

describe("agyModels and rememberAgyModels", () => {
  it("is empty before agy has answered", async () => {
    const { agyModels } = await load();
    expect(agyModels()).toEqual([]);
  });

  it("keeps agy's answer on disk, so the next launch reads it", async () => {
    const first = await load();
    first.rememberAgyModels(ANSWER);
    expect(first.agyModels()).toHaveLength(3);
    const again = await load();
    expect(again.agyModels().map((m) => m.id)).toEqual(["gemini-3.8-flash-high", "claude-sonnet-4-6", "gpt-oss-120b-medium"]);
  });

  it("leaves the old list alone for a malformed answer, and doesn't rewrite an unchanged one", async () => {
    const { agyModels, rememberAgyModels } = await load();
    rememberAgyModels(ANSWER);
    const write = vi.spyOn(fs, "writeFileSync");
    rememberAgyModels(undefined);
    rememberAgyModels({ availableModels: [] });
    rememberAgyModels(ANSWER);
    expect(write).not.toHaveBeenCalled();
    expect(agyModels()).toHaveLength(3);
  });

  it("reads a file that isn't a list of models as none", async () => {
    fs.writeFileSync(file(), JSON.stringify([{ id: 1 }]));
    expect((await load()).agyModels()).toEqual([]);
    fs.writeFileSync(file(), "not json");
    expect((await load()).agyModels()).toEqual([]);
  });

  it("still offers the new list when the file can't be written", async () => {
    const { agyModels, rememberAgyModels } = await load();
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("disk full");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    rememberAgyModels(ANSWER);
    expect(agyModels()).toHaveLength(3);
    expect(warn).toHaveBeenCalled();
  });
});
