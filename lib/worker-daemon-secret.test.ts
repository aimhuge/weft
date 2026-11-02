// The daemon's `secret_use` (docs/architecture/project-hosts.md#secrets-on-a-worker-h8-the-per-use-seal-as-built): it hands
// the sealed answer to deps.secretUse, which opens it for the card's waiting mcp__secrets__run.
import { describe, expect, it, vi } from "vitest";
import { command, makeDeps } from "./worker-daemon.harness";

describe("secret_use", () => {
  it("hands a secret_use to the waiting ask and reports its card, or fails it without one", async () => {
    const secretUse = vi.fn(() => "card-1");
    const d = makeDeps({ secretUse });
    const use = command({ kind: "secret_use", folder: "-", payload: { cardId: "card-1" } as never });
    await d.daemon.runOne(use);
    expect(secretUse).toHaveBeenCalledWith(use);
    expect(d.report).toHaveBeenCalledWith("cmd-1", "done", "card-1", null);
    secretUse.mockImplementationOnce(() => {
      throw new Error("That secret use answers no open ask: it was already used, it expired, or it was never asked for.");
    });
    await d.daemon.runOne(use);
    expect(d.report).toHaveBeenLastCalledWith("cmd-1", "failed", null, expect.stringContaining("already used"));
    const old = makeDeps();
    await old.daemon.runOne(use);
    expect(old.report).toHaveBeenLastCalledWith("cmd-1", "failed", null, expect.stringContaining("doesn't know that kind"));
  });

  it("hands a connector token to deps.connector (lib/worker-connectors.ts), or fails it on a wiring without one", async () => {
    const connector = vi.fn(() => null);
    const d = makeDeps({ connector });
    const lent = command({ kind: "connector", folder: "-", payload: { op: "token", connector: "gh" } as never });
    await d.daemon.runOne(lent);
    expect(connector).toHaveBeenCalledWith(lent);
    expect(d.report).toHaveBeenCalledWith("cmd-1", "done", null, null);
    const old = makeDeps();
    await old.daemon.runOne(lent);
    expect(old.report).toHaveBeenLastCalledWith("cmd-1", "failed", null, expect.stringContaining("doesn't know that kind"));
  });
});
