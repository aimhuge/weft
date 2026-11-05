import { afterEach, describe, expect, it, vi } from "vitest";
import { offProjectOpen, projectOpened } from "./project-open";
import { startVercelDrift } from "./vercel-drift-open";

// A project landing on the board asks main for its drift once, behind the open, and a failure stays quiet.

describe("vercel-drift-open", () => {
  afterEach(() => offProjectOpen("vercel-drift"));

  it("asks main for the opened folder's drift on a later tick", async () => {
    const ask = vi.fn(() => Promise.resolve({}));
    startVercelDrift(ask);
    projectOpened("/dev/web");
    expect(ask).not.toHaveBeenCalled();
    await new Promise((r) => setImmediate(r));
    expect(ask).toHaveBeenCalledWith("/vercel/env-drift", { folders: ["/dev/web"] });
  });

  it("swallows a main that isn't there", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ask = vi.fn((): Promise<Record<string, unknown>> => Promise.reject(new Error("no pane")));
    startVercelDrift(ask);
    projectOpened("/dev/web");
    await new Promise((r) => setImmediate(r));
    await Promise.resolve();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
