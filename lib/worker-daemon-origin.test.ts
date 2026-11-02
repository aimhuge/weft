import { describe, expect, it } from "vitest";
import { command, makeDeps } from "./worker-daemon.harness";

describe("a run another of the user's workers sent", () => {
  it("starts a card another worker sent in default, whatever it names (lib/worker-origin.ts)", async () => {
    const d = makeDeps();
    await d.daemon.runOne(command({ payload: { prompt: "go", permissionMode: "acceptEdits", fromWorker: "w-2" } as never }));
    expect(d.start).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: "default" }));
    await d.daemon.runOne(command({ id: "c-2", payload: { prompt: "go", fromWorker: "w-2" } as never }));
    expect(d.start).toHaveBeenLastCalledWith(expect.objectContaining({ permissionMode: "default" }));
  });
});
