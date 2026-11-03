// A line offered over the LAN port (lib/worker-daemon.ts lanLine): the `line` kind as the owner's row would run it, its
// sealed answer handed back for the port's reply.
import { describe, expect, it, vi } from "vitest";
import type { CloudCommandRow } from "./cloud-commands";
import { lanLine } from "./worker-daemon";
import { makeDeps } from "./worker-daemon.harness";

const sealed = { v: 1 as const, epk: "a", iv: "b", ct: "c", tag: "d" };
const answer = { iv: "aXY=", ct: "Y3Q=" };

describe("lanLine", () => {
  it("opens the line as the owner's line command and resolves with its answer", async () => {
    const open = vi.fn((_: CloudCommandRow, answerOn?: (topic: string, a: typeof answer) => Promise<unknown>) => answerOn!("worker-line:t", answer).then(() => null));
    await expect(lanLine(open, "u1", sealed)).resolves.toEqual(answer);
    const row = open.mock.calls[0]![0];
    expect(row).toMatchObject({ kind: "line", created_by: "u1", payload: { sealed }, status: "claimed" });
    expect(row.id).toMatch(/^lan-/);
  });

  it("refuses when the line closed without answering, or didn't open", async () => {
    await expect(lanLine(() => Promise.resolve(null), undefined, sealed)).rejects.toThrow("closed before it answered");
    await expect(lanLine(() => Promise.reject(new Error("bad seal")), "u1", sealed)).rejects.toThrow("bad seal");
  });

  it("is on the daemon, through its own kind table's line", async () => {
    const line = vi.fn((_s: unknown, _run: unknown, answerOn?: (topic: string, a: typeof answer) => Promise<unknown>) => answerOn!("t", answer).then(() => undefined));
    const { daemon } = makeDeps({ line, owner: "u1" });
    await expect(daemon.lanLine(sealed)).resolves.toEqual(answer);
    expect(line).toHaveBeenCalledWith(sealed, expect.any(Function), expect.any(Function));
  });
});
