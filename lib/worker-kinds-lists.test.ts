// A worker's own crons and webhooks changed from the Mac's drawers (lib/worker-kinds.ts listVerb): the host kind's
// list path, past remoteRefusal, and a run from the network narrowed to the mode a new card from it would get.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Cron } from "./cron-types";
import { command, fakeEngine, fakeGithub, fakePublisher, fakeReg } from "./worker-daemon.harness";
import type { DaemonDeps } from "./worker-daemon";

const crons = vi.hoisted(() => new Map<string, Partial<Cron>>());
vi.mock("./cron-store", () => ({ getCron: (id: string) => crons.get(id) }));

const { listVerb, workerKinds } = await import("./worker-kinds");

function kinds() {
  const eng = fakeEngine();
  eng.host.mockImplementation((verb) => Promise.resolve(verb === "cron.run" ? { card: { id: "run-1" } } : { ok: true }));
  const deps = { reg: fakeReg().reg, engine: eng.engine, publisher: fakePublisher().publisher, checkout: vi.fn(), login: vi.fn(), clone: vi.fn(), github: fakeGithub() } as unknown as DaemonDeps;
  return { kinds: workerKinds(deps, { log: vi.fn(), askForUpdate: () => null }), host: eng.host };
}

const host = (verb: string, args: Record<string, unknown>) => command({ kind: "host", payload: { verb, args } as never });

beforeEach(() => {
  crons.clear();
  crons.set("k1", { id: "k1", permissionMode: "auto" });
  crons.set("k2", { id: "k2", permissionMode: "bypassPermissions" });
  crons.set("k3", { id: "k3", permissionMode: "plan" as Cron["permissionMode"] });
});

describe("a worker's crons and webhooks from the Mac", () => {
  it("changes or deletes one through its verb, leaving the row's card empty", async () => {
    const t = kinds();
    expect(await t.kinds.host!(host("cron.update", { id: "k1", patch: { enabled: false } }))).toEqual({ cardId: null, result: { ok: true, cardId: "" } });
    expect(t.host).toHaveBeenCalledWith("cron.update", { id: "k1", patch: { enabled: false } });
    await t.kinds.host!(host("webhook.delete", { id: "h1" }));
    expect(t.host).toHaveBeenLastCalledWith("webhook.delete", { id: "h1" });
  });

  it("runs a cron now in the mode a card from the network may start in, and names the run's card", async () => {
    const t = kinds();
    expect(await t.kinds.host!(host("cron.run", { id: "k1" }))).toEqual({ cardId: null, result: { ok: true, cardId: "run-1" } });
    expect(t.host).toHaveBeenLastCalledWith("cron.run", { id: "k1", permissionMode: "auto" });
    await t.kinds.host!(host("cron.run", { id: "k3" }));
    expect(t.host).toHaveBeenLastCalledWith("cron.run", { id: "k3", permissionMode: "default" });
  });

  it("refuses a run that would skip prompts, one it doesn't have, and a mode smuggled into the row", async () => {
    const t = kinds();
    await expect(t.kinds.host!(host("cron.run", { id: "k2" }))).rejects.toThrow("That mode can't be set on a worker.");
    await expect(t.kinds.host!(host("cron.run", { id: "nope" }))).rejects.toThrow("No such cron.");
    await expect(t.kinds.host!(host("cron.run", { id: "k1", permissionMode: "bypassPermissions" }))).rejects.toThrow(/carries more than the cron/);
    expect(t.host).not.toHaveBeenCalled();
  });

  it("narrows a cron re-worded from the network to the mode a new card from it may start in", async () => {
    const t = kinds();
    await t.kinds.host!(host("cron.update", { id: "k2", patch: { prompt: "rm the repo" } }));
    expect(t.host).toHaveBeenLastCalledWith("cron.update", { id: "k2", patch: { prompt: "rm the repo" }, permissionMode: "default" });
    await t.kinds.host!(host("cron.update", { id: "k1", patch: { prompt: "tidy up", enabled: true } }));
    expect(t.host).toHaveBeenLastCalledWith("cron.update", { id: "k1", patch: { prompt: "tidy up", enabled: true }, permissionMode: "auto" });
    await expect(t.kinds.host!(host("cron.update", { id: "nope", patch: { prompt: "x" } }))).rejects.toThrow("No such cron.");
    await expect(t.kinds.host!(host("cron.update", { id: "k2", patch: { prompt: "x" }, permissionMode: "bypassPermissions" }))).rejects.toThrow(/carries more than the cron/);
  });

  it("is a plain function of the engine", async () => {
    const t = kinds();
    expect(await listVerb({ host: t.host }, "webhook.update", { id: "h1", patch: { registered: true } })).toBeNull();
  });
});
