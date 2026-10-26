// @vitest-environment node
// What lib/codex-runner.ts does when a `codex exec` turn dies before finishing: the stderr tail, the
// exit code or signal it names, a spawn that fails, and the abort that makes it say nothing. The
// turn-loop happy paths are in lib/codex-runner-events.test.ts; the fake child and mocks are shared
// through lib/codex-runner.harness.ts.
import { describe, expect, it, vi } from "vitest";
import { EXE, setupCodex } from "./codex-runner.harness";

const s = await vi.hoisted(async () => (await import("./codex-runner.harness")).codexState());

vi.mock("./guards/turn", async (o) => (await import("./codex-runner.harness")).guardsTurnMock(o));
vi.mock("./runner-turn", async () => (await import("./codex-runner.harness")).runnerTurnMock(s));
vi.mock("./store", async () => (await import("./codex-runner.harness")).storeMock(s));
vi.mock("./weft-mcp", async () => (await import("./codex-runner.harness")).weftMcpMock());
vi.mock("node:child_process", async () => (await import("./codex-runner.harness")).childProcessMock(s));
vi.mock("./settings", async (o) => (await import("./codex-runner.harness")).settingsMock(o));

const rig = setupCodex(s);

const event = (payload: Record<string, unknown>) => JSON.stringify(payload);

describe("a turn that dies mid-way", () => {
  it("throws the CLI's stderr tail when the turn never finished", async () => {
    const r = rig();
    const promise = r.codex.driveCodex(r.session, EXE);
    r.session.inbox.push("do it");
    await vi.waitFor(() => expect(s.spawned.length).toBe(1));
    r.child().stderr.write("stream error: unexpected eof\n");
    r.child().run(s, [], { code: 1 });
    await expect(r.finish(promise)).rejects.toThrow("stream error: unexpected eof");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("stream error"));
  });

  it("says how the CLI exited when it printed nothing", async () => {
    await expect(rig().start([], { code: 127 })).rejects.toThrow("Codex exited with code 127 without finishing the turn.");
  });

  it("names the signal that killed it", async () => {
    await expect(rig().start([], { code: null, signal: "SIGKILL" })).rejects.toThrow("Codex exited on SIGKILL without finishing the turn.");
  });

  it("throws the spawn error even after a complete turn", async () => {
    s.errorEvent = "spawn codex ENOENT";
    const r = rig();
    const promise = r.codex.driveCodex(r.session, EXE);
    r.session.inbox.push("do it");
    await vi.waitFor(() => expect(s.spawned.length).toBe(1));
    r.child().run(s, [event({ type: "turn.completed" })]);
    await expect(r.finish(promise)).rejects.toThrow("spawn codex ENOENT");
  });

  it("lets a spawn that throws straight through", async () => {
    s.throwOn = "spawn codex EACCES";
    const r = rig();
    r.session.inbox.push("do it");
    await expect(r.codex.driveCodex(r.session, EXE)).rejects.toThrow("spawn codex EACCES");
  });

  it("says nothing when the session was aborted mid-turn", async () => {
    const r = rig();
    const promise = r.codex.driveCodex(r.session, EXE);
    r.session.inbox.push("do it");
    await vi.waitFor(() => expect(s.spawned.length).toBe(1));
    r.session.abort.abort();
    r.child().run(s, [], { code: null, signal: "SIGTERM" });
    await expect(r.finish(promise)).resolves.toBeUndefined();
  });
});