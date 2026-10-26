import { describe, expect, it } from "vitest";
import { projectMenu, type ProjectMenuState } from "./project-menu";

const base: ProjectMenuState = { pinned: false, hidden: false, done: 0, live: 0, openIn: true };
const ids = (s: Partial<ProjectMenuState>) =>
  projectMenu("weft", { ...base, ...s }).flatMap((i) => ("id" in i ? [i.id] : []));
const item = (id: string, s: Partial<ProjectMenuState> = {}) =>
  projectMenu("weft", { ...base, ...s }).find((i) => "id" in i && i.id === id);

describe("projectMenu", () => {
  it("offers every action, named for the project, with keys", () => {
    expect(ids({})).toEqual([
      "new", "reveal", "editor", "terminal", "github", "copy-path", "secrets", "services", "changelog", "pin", "hide", "archive-done", "stop-running",
    ]);
    expect(item("new")).toEqual({ id: "new", label: "New Thread in weft", accelerator: "N" });
  });

  it("leaves out Open in Editor and Terminal when the shell can't do them", () => {
    expect(ids({ openIn: false })).not.toContain("editor");
    expect(ids({ openIn: false })).not.toContain("terminal");
  });

  it("flips Pin and Hide to Unpin and Show", () => {
    expect(ids({ pinned: true, hidden: true })).toEqual(expect.arrayContaining(["unpin", "show"]));
    expect(ids({ pinned: true })).not.toContain("pin");
  });

  it("counts the cards the bulk items touch, and greys them out at zero", () => {
    expect(item("archive-done")).toMatchObject({ label: "Archive Done Cards", enabled: false });
    expect(item("archive-done", { done: 1 })).toMatchObject({ label: "Archive 1 Card in Done", enabled: true });
    expect(item("stop-running", { live: 3 })).toMatchObject({ label: "Stop All 3 Running", enabled: true });
    expect(item("archive-done", { done: 4 })).toMatchObject({ label: "Archive All 4 in Done" });
    expect(item("stop-running", { live: 1 })).toMatchObject({ label: "Stop 1 Running Card" });
    expect(item("stop-running")).toMatchObject({ label: "Stop Running Cards", enabled: false });
  });
});
