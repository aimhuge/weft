import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { offProjectOpen, onProjectOpen, projectOpened } from "./project-open";

const tick = () => new Promise((r) => setImmediate(r));

afterEach(() => {
  for (const n of ["a", "b", "bad", "reject"]) offProjectOpen(n);
  vi.restoreAllMocks();
});

describe("project-open hook", () => {
  it("runs each handler on a later tick, never inline", async () => {
    const seen: string[] = [];
    onProjectOpen("a", (f) => void seen.push(`a ${f}`));
    onProjectOpen("b", (f) => void seen.push(`b ${f}`));
    projectOpened("/p");
    expect(seen).toEqual([]);
    await tick();
    expect(seen.sort()).toEqual(["a /p", "b /p"]);
  });

  it("replaces a handler registered under the same name, and off removes it", async () => {
    const first = vi.fn();
    const second = vi.fn();
    onProjectOpen("a", first);
    onProjectOpen("a", second);
    projectOpened("/p");
    await tick();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("/p");
    offProjectOpen("a");
    projectOpened("/q");
    await tick();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("logs a handler that throws or rejects, and still runs the others", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ok = vi.fn();
    onProjectOpen("bad", () => {
      throw new Error("boom");
    });
    onProjectOpen("reject", () => Promise.reject(new Error("later")));
    onProjectOpen("a", ok);
    projectOpened("/p");
    await tick();
    await tick();
    expect(ok).toHaveBeenCalledWith("/p");
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("touchProject", () => {
  it("tells the hook about a folder new to the recent projects, not a known one", async () => {
    process.env.WEFT_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "weft-open-"));
    const s = await import("./settings");
    const seen: string[] = [];
    onProjectOpen("a", (f) => void seen.push(f));
    s.touchProject("/new");
    s.touchProject("/new");
    await tick();
    expect(seen).toEqual(["/new"]);
  });
});
