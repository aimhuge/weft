import { describe, expect, it } from "vitest";
import { updateView } from "./update-view.cjs";

const NOW = 1_800_000_000_000;
const view = (state: object) => updateView({ state, currentVersion: "0.8.0", packaged: false, dev: true }, NOW);
const actions = (v: { buttons: { action: string }[] }) => v.buttons.map((b) => b.action);

describe("updateView in dev mode", () => {
  it("before a check, says it follows main", () => {
    const v = view({ phase: "idle" });
    expect(v).toMatchObject({ tone: "idle", current: "Weft 0.8.0 (dev)", latest: "" });
    expect(v.detail).toMatch(/follows main/);
    expect(actions(v)).toEqual(["check"]);
  });

  it("new commits offer Update Now, with main's commit as the newest", () => {
    const v = view({ phase: "available", commits: 3, target: "abc1234", notes: "- feat: x" });
    expect(v).toMatchObject({ tone: "new", title: "3 new commits on main", latest: "main @ abc1234", notes: "- feat: x" });
    expect(v.buttons.at(-1)).toEqual({ action: "pull", label: "Update Now", primary: true });
  });

  it("pulling is busy", () => {
    const v = view({ phase: "pulling", commits: 1 });
    expect(v).toMatchObject({ tone: "busy", title: "Updating to 1 new commit…" });
    expect(v.buttons[0]).toMatchObject({ disabled: true });
  });

  it("a pull that moved Electron's code asks for a restart", () => {
    const v = view({ phase: "ready", version: "0.8.2" });
    expect(v.title).toBe("Weft 0.8.2 is pulled");
    expect(actions(v)).toEqual(["close", "install"]);
    expect(view({ phase: "ready" }).title).toBe("Restart to finish updating");
  });

  it("a pull that needed no restart, up to date and errors", () => {
    expect(view({ phase: "idle", upToDate: true, pulled: 2 }).title).toBe("Updated: 2 commits");
    expect(view({ phase: "idle", upToDate: true }).title).toBe("You're up to date");
    const e = view({ phase: "idle", error: "git couldn't fast-forward" });
    expect(e).toMatchObject({ tone: "error", title: "Couldn't update" });
    expect(e.buttons).toEqual([{ action: "check", label: "Try Again", primary: true }]);
    expect(view({ phase: "checking" }).tone).toBe("busy");
  });
});
