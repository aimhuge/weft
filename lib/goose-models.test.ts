import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { settingsDir, withSettingsDir } from "./settings.harness";

withSettingsDir();

// The settings live in a global singleton, so each test loads the module fresh — otherwise the
// second test would read the first one's settings.
async function load() {
  vi.resetModules();
  const { namedModels, setNamedModels } = await import("./goose-models");
  return { namedModels, setNamedModels };
}

describe("the named models", () => {
  it("are none until one is saved", async () => {
    const { namedModels } = await load();
    expect(namedModels()).toEqual([]);
  });

  it("keep the order the user set them in", async () => {
    const { namedModels, setNamedModels } = await load();
    setNamedModels([
      { id: "b", name: "Second" },
      { id: "a", name: "First" },
    ]);
    expect(namedModels()).toEqual([
      { id: "b", name: "Second" },
      { id: "a", name: "First" },
    ]);
  });

  it("drop the empty ones and the ones with no name", async () => {
    const { namedModels, setNamedModels } = await load();
    setNamedModels([
      { id: "", name: "No id" },
      { id: "no-name", name: "  " },
      { id: "  ", name: "No id either" },
      { id: "good", name: "Kept" },
    ]);
    expect(namedModels()).toEqual([{ id: "good", name: "Kept" }]);
  });

  it("trim the id and the name", async () => {
    const { namedModels, setNamedModels } = await load();
    setNamedModels([{ id: "  puku-ai-2.8  ", name: "  My Puku  " }]);
    expect(namedModels()).toEqual([{ id: "puku-ai-2.8", name: "My Puku" }]);
  });

  it("keep the first of a repeated id, and drop the rest", async () => {
    const { namedModels, setNamedModels } = await load();
    setNamedModels([
      { id: "same", name: "First" },
      { id: "same", name: "Second" },
    ]);
    expect(namedModels()).toEqual([{ id: "same", name: "First" }]);
  });

  it("read a list that isn't pairs of strings as none", async () => {
    fs.writeFileSync(
      path.join(settingsDir.path, "settings.json"),
      JSON.stringify({ gooseNamedModels: [{ id: "gpt-5" }] }),
    );
    const { namedModels } = await load();
    expect(namedModels()).toEqual([]);
  });

  it("drop a malformed list rather than losing every name", async () => {
    // A list that is not a list of pairs at all reads as none; the point of the check is that a
    // hand-edited file can't take the user's names down with it.
    fs.writeFileSync(
      path.join(settingsDir.path, "settings.json"),
      JSON.stringify({ gooseNamedModels: "not a list" }),
    );
    const { namedModels } = await load();
    expect(namedModels()).toEqual([]);
  });

  it("store an empty list as unset, since it is the default", async () => {
    const { namedModels, setNamedModels } = await load();
    setNamedModels([{ id: "a", name: "A" }]);
    setNamedModels([]);
    const saved = JSON.parse(fs.readFileSync(path.join(settingsDir.path, "settings.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect("gooseNamedModels" in saved).toBe(false);
    expect(namedModels()).toEqual([]);
  });
});
