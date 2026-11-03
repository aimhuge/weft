// A worker's vault_keep (lib/worker-kinds.ts): only when the wiring keeps values (lib/worker-kept-vault.ts), answered
// with what it holds now.
import { describe, expect, it, vi } from "vitest";
import { command, fakeEngine, fakeGithub, fakePublisher, fakeReg } from "./worker-daemon.harness";
import type { DaemonDeps } from "./worker-daemon";
import { workerKinds } from "./worker-kinds";

const kindsWith = (keep?: DaemonDeps["keep"]) =>
  workerKinds({ reg: fakeReg().reg, engine: fakeEngine().engine, publisher: fakePublisher().publisher, checkout: vi.fn(), login: vi.fn(), clone: vi.fn(), github: fakeGithub(), keep }, { log: vi.fn(), askForUpdate: () => null });

describe("vault_keep", () => {
  it("hands the row to the kept vault and answers what it holds", async () => {
    const keep = vi.fn(() => ({ seq: 4, kept: 2 }));
    const row = command({ kind: "vault_keep", payload: { keep: {} } as never });
    await expect(kindsWith(keep).vault_keep!(row)).resolves.toEqual({ cardId: "", result: { ok: true, cardId: "", value: { seq: 4, kept: 2 } } });
    expect(keep).toHaveBeenCalledWith(row);
  });

  it("isn't a kind on a worker that keeps nothing", () => {
    expect(kindsWith().vault_keep).toBeUndefined();
  });
});
