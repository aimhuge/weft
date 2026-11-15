// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { boardMode, viewMode } from "./board-prefs";
import { applyStop, currentStop, nextStop } from "./view-stops";

afterEach(() => {
  for (const name of ["weft-board-mode", "weft-view-mode"]) document.cookie = `${name}=; path=/; max-age=0`;
});

describe("view stops", () => {
  it("rings Simple → Board → List → Simple", () => {
    expect(nextStop("simple")).toBe("board");
    expect(nextStop("board")).toBe("list");
    expect(nextStop("list")).toBe("simple");
  });

  it("puts the board on each stop and reads it back", () => {
    expect(currentStop()).toBe("board");
    applyStop("list");
    expect([boardMode(), viewMode(), currentStop()]).toEqual(["advanced", "list", "list"]);
    applyStop("simple");
    expect([boardMode(), currentStop()]).toEqual(["regular", "simple"]);
    applyStop("board");
    expect([boardMode(), viewMode(), currentStop()]).toEqual(["advanced", "board", "board"]);
  });
});
