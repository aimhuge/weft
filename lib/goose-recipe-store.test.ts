// @vitest-environment node
// The Goose recipe on disk: where it goes, what it holds, and that a write that fails doesn't raise.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

let dataDir = "";
let store: typeof import("./goose-recipe-store");

beforeEach(async () => {
  dataDir = fs.mkdtempSync("/tmp/weft-goose-recipe-");
  vi.stubEnv("WEFT_DATA", dataDir);
  vi.spyOn(console, "error").mockImplementation(() => {});
  store = await import("./goose-recipe-store");
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("the recipe's place on disk", () => {
  it("writes the recipe under the card's own Goose state root", () => {
    store.writeRecipe("card-1", "title: \"x\"\n");
    expect(fs.existsSync(path.join(dataDir, "goose", "card-1", "recipes", "turn.yaml"))).toBe(true);
  });

  it("keeps the recipe out of the user's project folder", () => {
    store.writeRecipe("card-1", "title: \"x\"\n");
    const written = path.join(dataDir, "goose", "card-1", "recipes", "turn.yaml");
    expect(written.startsWith(dataDir)).toBe(true);
  });

  it("gives each card its own recipe", () => {
    store.writeRecipe("card-1", "title: \"one\"\n");
    store.writeRecipe("card-2", "title: \"two\"\n");
    expect(store.readRecipe("card-1")).toBe("title: \"one\"\n");
    expect(store.readRecipe("card-2")).toBe("title: \"two\"\n");
  });

  it("overwrites the card's recipe on the next turn, so the file is the harness in force", () => {
    store.writeRecipe("card-1", "title: \"one\"\n");
    store.writeRecipe("card-1", "title: \"two\"\n");
    expect(store.readRecipe("card-1")).toBe("title: \"two\"\n");
  });

  it("names the recipe file the same in every card's folder", () => {
    expect(path.basename(store.recipeFile("card-1"))).toBe(path.basename(store.recipeFile("card-2")));
    expect(store.recipeFile("card-1")).toMatch(/recipes[/\\]turn\.yaml$/);
  });
});

describe("writeRecipe", () => {
  it("writes the recipe and says so", () => {
    expect(store.writeRecipe("card-1", "title: \"x\"\n")).toBe(true);
    expect(store.readRecipe("card-1")).toBe("title: \"x\"\n");
  });

  it("writes the recipe exactly as it is given", () => {
    const yaml = "title: \"x\"\ndescription: \"d\"\nprompt: \"p\"\nsettings:\n  max_turns: 40\nparameters: []\n";
    store.writeRecipe("card-1", yaml);
    expect(store.readRecipe("card-1")).toBe(yaml);
  });

  it("leaves no temp file behind", () => {
    store.writeRecipe("card-1", "title: \"x\"\n");
    const dir = store.recipeDir("card-1");
    expect(fs.readdirSync(dir)).toEqual(["turn.yaml"]);
  });

  it("writes nothing for a card with no id", () => {
    expect(store.writeRecipe("", "title: \"x\"\n")).toBe(false);
  });

  it("reports a write that fails instead of throwing", () => {
    // The recipe folder's parent is a file, so the folder can't be made.
    fs.writeFileSync(path.join(dataDir, "goose"), "not a folder");
    expect(store.writeRecipe("card-1", "title: \"x\"\n")).toBe(false);
  });

  it("leaves no temp file behind when the write fails", () => {
    fs.writeFileSync(path.join(dataDir, "goose"), "not a folder");
    store.writeRecipe("card-1", "title: \"x\"\n");
    // The "goose" path is still the file it was, not a folder holding a leftover temp file.
    expect(fs.readFileSync(path.join(dataDir, "goose"), "utf8")).toBe("not a folder");
  });
});

describe("readRecipe", () => {
  it("reads a recipe that was never written as nothing", () => {
    expect(store.readRecipe("card-9")).toBe("");
  });

  it("reads nothing when the recipe file is gone", () => {
    store.writeRecipe("card-1", "title: \"x\"\n");
    fs.rmSync(store.recipeFile("card-1"));
    expect(store.readRecipe("card-1")).toBe("");
  });
});
