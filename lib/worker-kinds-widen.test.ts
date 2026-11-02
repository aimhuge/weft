// Signed widening on a worker's kinds (lib/worker-kinds.ts, lib/worker-card-commands.ts): a new folder runs in that
// project's checkout, a new thread takes an agent only with its approval, and `pin` hands endorsements to the signers.
import { describe, expect, it, vi } from "vitest";
import { command, fakeEngine, fakeGithub, fakePublisher, fakeReg } from "./worker-daemon.harness";
import type { DaemonDeps } from "./worker-daemon";
import { workerKinds } from "./worker-kinds";
import { nonceBook } from "./widen-nonces";
import type { WorkerWiden } from "./worker-widen";

const NOW = 3_000_000;
const auth = (nonce: string) => ({ kind: "ed25519", device: "mac", issuedAt: NOW, nonce, sig: "c2ln" });

function setup(withWiden = true) {
  const eng = fakeEngine();
  const nameFolder = vi.fn();
  const endorse = vi.fn(() => Promise.resolve());
  const pub = fakePublisher();
  const widen: WorkerWiden = {
    host: "w1",
    signers: { verify: vi.fn(() => Promise.resolve({ ok: true })), verifyPasskey: vi.fn(), endorse },
    nonces: nonceBook({ load: () => ({}), save: () => {} }, () => NOW),
    projects: () => ["app", "site"],
    root: "/w",
    projectPath: (f) => `/w/${f}`,
    nameFolder,
    now: () => NOW,
  };
  const checkout = vi.fn((folder: string) => Promise.resolve(`/w/${folder}`));
  const deps = { reg: fakeReg().reg, engine: eng.engine, publisher: pub.publisher, checkout, login: vi.fn(), clone: vi.fn(), github: fakeGithub(), ...(withWiden ? { widen } : {}) } as unknown as DaemonDeps;
  return { kinds: workerKinds(deps, { log: vi.fn(), askForUpdate: () => null }), eng, widen, nameFolder, endorse };
}

describe("a worker's signed widening", () => {
  it("moves a card to another project with an approval, running it in that checkout", async () => {
    const t = setup();
    const payload = { verb: "card.update", args: { id: "card-1", body: { cwd: "site" }, widen: auth("abcdefghijklmnop") } };
    await t.kinds.host!(command({ kind: "host", payload: payload as never }));
    expect(t.eng.host).toHaveBeenCalledWith("card.update", { id: "card-1", body: { cwd: "/w/site" } });
    expect(t.nameFolder).toHaveBeenCalledWith("card-1", "site");
    await expect(t.kinds.host!(command({ kind: "host", payload: { verb: "card.update", args: { id: "card-1", body: { cwd: "/etc" }, widen: auth("qrstuvwxyzabcdef") } } as never }))).rejects.toThrow(/isn't a project/);
  });

  it("starts a thread with an agent only with its approval", async () => {
    const t = setup();
    const run = (payload: Record<string, unknown>) => command({ kind: "run", folder: "app", payload: { prompt: "go", ...payload } as never });
    await t.kinds.run!(run({ agent: "builder", widen: auth("abcdefghijklmnop") }));
    expect(t.eng.start).toHaveBeenLastCalledWith(expect.objectContaining({ agent: "builder", cwd: "/w/app" }));
    await expect(t.kinds.run!(run({ agent: "builder" }))).rejects.toThrow(/needs your approval/);
    await t.kinds.run!(run({}));
    expect(t.eng.start).toHaveBeenLastCalledWith(expect.not.objectContaining({ agent: expect.anything() as unknown }));
    await expect(setup(false).kinds.run!(run({ agent: "builder", widen: auth("abcdefghijklmnop") }))).rejects.toThrow(/needs your approval/);
  });

  it("pins endorsed passkeys through its signers, and says when it can't", async () => {
    const t = setup();
    await t.kinds.pin!(command({ kind: "pin", payload: { endorsements: [{ a: 1 }, { b: 2 }] } as never }));
    expect(t.endorse).toHaveBeenCalledTimes(2);
    expect(t.endorse).toHaveBeenCalledWith({ a: 1 }, "w1", NOW);
    await expect(t.kinds.pin!(command({ kind: "pin", payload: { endorsements: [] } as never }))).rejects.toThrow(/no endorsements/);
    await expect(t.kinds.pin!(command({ kind: "pin", payload: null as never }))).rejects.toThrow(/no endorsements/);
    await expect(setup(false).kinds.pin!(command({ kind: "pin", payload: { endorsements: [{}] } as never }))).rejects.toThrow(/doesn't take passkeys/);
    const late = setup();
    late.widen.now = undefined;
    await late.kinds.pin!(command({ kind: "pin", payload: { endorsements: [{}] } as never }));
    expect(late.endorse).toHaveBeenCalled();
  });
});
