import { describe, expect, it, vi } from "vitest";
import { enrol, registry, type Rpc } from "./worker-registry";

// A fake Supabase rpc: it records the call and answers with whatever the test set.
function fakeRpc(result: { data?: unknown; error?: { message: string } | null } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  });
  return { rpc: rpc as unknown as Rpc, calls, mock: rpc };
}

describe("enrol", () => {
  it("trades a token for the worker's own key", async () => {
    const { rpc, calls } = fakeRpc({
      data: { worker_id: "w-1", org_id: "org-1", owner_user: "u-1", device: "worker:w-1", key: "wwk_key" },
    });
    expect(await enrol(rpc, "  tok-1  ", { name: "mini", platform: "darwin", arch: "arm64" })).toEqual({
      workerId: "w-1",
      orgId: "org-1",
      ownerUser: "u-1",
      device: "worker:w-1",
      key: "wwk_key",
      name: "mini",
    });
    expect(calls).toEqual([
      {
        fn: "worker_enrol",
        args: { p_token: "tok-1", p_name: "mini", p_platform: "darwin", p_arch: "arm64" },
      },
    ]);
  });

  it("throws the database's error", async () => {
    const { rpc } = fakeRpc({ error: { message: "token already used" } });
    await expect(enrol(rpc, "tok", { name: "mini", platform: "linux", arch: "x64" })).rejects.toThrow(
      "worker_enrol: token already used",
    );
  });
});

describe("registry", () => {
  const key = "wwk_key";

  it("reports the GitHub sign-in, never a token", async () => {
    const { rpc, calls } = fakeRpc();
    await registry(rpc, key).setGithub("signed_in", "octocat");
    expect(calls).toEqual([{ fn: "worker_set_github", args: { p_key: key, p_state: "signed_in", p_account: "octocat" } }]);
  });

  it("heartbeats with the status and the key", async () => {
    const { rpc, calls } = fakeRpc();
    await registry(rpc, key).heartbeat("busy");
    expect(calls).toEqual([{ fn: "worker_heartbeat", args: { p_key: key, p_status: "busy" } }]);
  });

  it("asks for pending commands", async () => {
    const { rpc, calls } = fakeRpc({ data: [{ id: "cmd-1" }] });
    expect(await registry(rpc, key).pending()).toEqual([{ id: "cmd-1" }]);
    expect(calls).toEqual([{ fn: "worker_pending", args: { p_key: key } }]);
  });

  it("treats no pending commands as none", async () => {
    const { rpc } = fakeRpc({ data: null });
    expect(await registry(rpc, key).pending()).toEqual([]);
  });

  it("claims a command", async () => {
    const { rpc, calls } = fakeRpc({ data: true });
    expect(await registry(rpc, key).claim("cmd-1")).toBe(true);
    expect(calls).toEqual([{ fn: "worker_claim", args: { p_key: key, p_command: "cmd-1" } }]);
  });

  it("reports a command done", async () => {
    const { rpc, calls } = fakeRpc();
    await registry(rpc, key).report("cmd-1", "done", "card-1", null);
    expect(calls).toEqual([
      { fn: "worker_report", args: { p_key: key, p_command: "cmd-1", p_status: "done", p_card: "card-1", p_error: null } },
    ]);
  });

  it("reports a command failed", async () => {
    const { rpc, calls } = fakeRpc();
    await registry(rpc, key).report("cmd-1", "failed", null, "boom");
    expect(calls).toEqual([
      { fn: "worker_report", args: { p_key: key, p_command: "cmd-1", p_status: "failed", p_card: null, p_error: "boom" } },
    ]);
  });

  it("puts a card", async () => {
    const { rpc, calls } = fakeRpc();
    await registry(rpc, key).putCard("card-1", "weft", { id: "card-1" });
    expect(calls).toEqual([
      {
        fn: "worker_put_card",
        args: { p_key: key, p_card_id: "card-1", p_folder: "weft", p_card: { id: "card-1" }, p_deleted: false },
      },
    ]);
  });

  it("puts a card as deleted", async () => {
    const { rpc, calls } = fakeRpc();
    await registry(rpc, key).putCard("card-1", "weft", {}, true);
    expect(calls[0]?.args).toEqual({ p_key: key, p_card_id: "card-1", p_folder: "weft", p_card: {}, p_deleted: true });
  });

  it("puts thread items and their tool outputs", async () => {
    const { rpc, calls } = fakeRpc();
    const items = [{ seq: 0, kind: "user", item: { kind: "user" }, at: "2026-10-29T00:00:00.000Z" }];
    const outputs = [{ tool_id: "t1", result: "out", bytes: 3 }];
    await registry(rpc, key).putItems("card-1", items, outputs, null);
    expect(calls).toEqual([
      {
        fn: "worker_put_items",
        args: { p_key: key, p_card_id: "card-1", p_items: items, p_outputs: outputs, p_from_seq: null },
      },
    ]);
  });

  it("throws the function's name with the message", async () => {
    const { rpc } = fakeRpc({ error: { message: "boom" } });
    await expect(registry(rpc, key).heartbeat("online")).rejects.toThrow("worker_heartbeat: boom");
    await expect(registry(rpc, key).pending()).rejects.toThrow("worker_pending: boom");
    await expect(registry(rpc, key).claim("cmd-1")).rejects.toThrow("worker_claim: boom");
    await expect(registry(rpc, key).report("cmd-1", "done", null, null)).rejects.toThrow("worker_report: boom");
    await expect(registry(rpc, key).putCard("card-1", "weft", {})).rejects.toThrow("worker_put_card: boom");
    await expect(registry(rpc, key).putItems("card-1", [], [], null)).rejects.toThrow("worker_put_items: boom");
  });
});
