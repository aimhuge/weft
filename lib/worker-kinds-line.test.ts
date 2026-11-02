// A session line's verbs on a worker (lib/worker-kinds.ts line): the `host` kind's own checks, refused while the worker
// updates itself, and logged with their card and outcome as the inbox logs a row.
import { describe, expect, it, vi } from "vitest";
import { command, fakeEngine, fakeGithub, fakePublisher, fakeReg } from "./worker-daemon.harness";
import type { DaemonDeps } from "./worker-daemon";
import { workerKinds } from "./worker-kinds";

const sealed = { v: 1, epk: "a", iv: "b", ct: "c", tag: "d" };

function lineRun(updating: boolean, carry?: (json: string) => Promise<string>) {
  let run: (payload: unknown) => Promise<unknown> = () => Promise.resolve();
  const line = vi.fn((_: unknown, r: (payload: unknown) => Promise<unknown>) => {
    run = r;
    return Promise.resolve();
  });
  const eng = fakeEngine();
  const deps = { reg: fakeReg().reg, engine: { ...eng.engine, carry }, publisher: fakePublisher().publisher, checkout: vi.fn(), login: vi.fn(), clone: vi.fn(), github: fakeGithub(), line } as unknown as DaemonDeps;
  const log = vi.fn();
  const kinds = workerKinds(deps, { log, askForUpdate: () => null, updating: () => updating });
  return { kinds, log, d: eng, run: (payload: unknown) => run(payload) };
}

describe("a verb over a line", () => {
  it("runs through the host kind and is logged", async () => {
    const t = lineRun(false);
    await t.kinds.line!(command({ kind: "line", payload: { sealed } as never }));
    await expect(t.run({ verb: "card.stop", args: { id: "card-1" } })).resolves.toMatchObject({ cardId: "card-1" });
    expect(t.d.host).toHaveBeenCalledWith("card.stop", { id: "card-1" });
    expect(t.log).toHaveBeenCalledWith("Weft Worker: line card.stop on card-1: done");
    await expect(t.run({ verb: "card.shell", args: { id: "card-1", command: "ls" } })).rejects.toThrow("only runs");
    expect(t.log).toHaveBeenLastCalledWith(expect.stringMatching(/^Weft Worker: line card\.shell on card-1 failed: A shell command only runs/));
    await expect(t.run(null)).rejects.toThrow();
    expect(t.log).toHaveBeenLastCalledWith(expect.stringMatching(/^Weft Worker: line undefined on undefined failed/));
  });

  it("is refused while the worker updates itself", async () => {
    const t = lineRun(true);
    await t.kinds.line!(command({ kind: "line", payload: { sealed } as never }));
    await expect(t.run({ verb: "card.stop", args: { id: "card-1" } })).rejects.toThrow("updating itself");
    expect(t.d.host).not.toHaveBeenCalled();
  });

  it("answers the editor's verbs with their value, a large one as a blob, as the relay does", async () => {
    const carry = vi.fn(() => Promise.resolve("ab".repeat(32)));
    const t = lineRun(false, carry);
    await t.kinds.line!(command({ kind: "line", payload: { sealed } as never }));
    t.d.host.mockResolvedValueOnce({ files: ["a.ts"] });
    await expect(t.run({ verb: "files.list", args: { id: "card-1" } })).resolves.toMatchObject({ result: { ok: true, cardId: "card-1", value: { files: ["a.ts"] } } });
    t.d.host.mockResolvedValueOnce({ file: { text: "x".repeat(5_000) } });
    await expect(t.run({ verb: "files.read", args: { id: "card-1", path: "a.ts" } })).resolves.toMatchObject({ result: { ok: true, cardId: "card-1", blob: "ab".repeat(32) } });
    await expect(t.run({ verb: "files.read", args: { id: "card-1", path: ".ssh/id_rsa" } })).rejects.toThrow("holds credentials");
  });
});
