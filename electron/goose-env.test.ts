// electron/goose-env.cjs: claims the grant, runs Goose with the key in its env, and passes its output on.
// The exits wait for the pipes to drain: on macOS a pipe is asynchronous, so an exit right after a write loses it.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { main } from "./goose-env.cjs";

// A sink that holds each write's callback until it is drained, like a pipe on macOS.
function pipe() {
  const pending: Array<() => void> = [];
  let text = "";
  return {
    write(chunk: string, done?: () => void) {
      text += chunk;
      if (done) pending.push(done);
      return true;
    },
    drain: () => pending.splice(0).forEach((done) => done()),
    text: () => text,
  };
}

function child() {
  const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
  return proc;
}

function rig(claim: { ok: boolean; body: unknown }) {
  const stdout = pipe();
  const stderr = pipe();
  const exit = vi.fn();
  const log = vi.fn();
  const proc = child();
  const spawnImpl = vi.fn(() => proc);
  const request = { url: "http://127.0.0.1:1", token: "t", grant: "g", argv: ["/opt/homebrew/bin/goose", "run", "--text", "hi"], env: { GOOSE_PATH_ROOT: "/tmp/goose-root" }, cwd: "/tmp" };
  const fetchImpl = vi.fn(() => Promise.resolve({ ok: claim.ok, statusText: "Forbidden", json: () => Promise.resolve(claim.body) }));
  const done = main({ stdin: Readable.from([JSON.stringify(request)]), stdout, stderr, env: {}, fetchImpl, spawnImpl, exit, log, onSignal: () => {} });
  return { stdout, stderr, exit, log, proc, spawnImpl, done };
}

describe("goose-env main", () => {
  it("runs argv[0] as the program and the rest as its arguments", async () => {
    const r = rig({ ok: true, body: { env: { ANTHROPIC_API_KEY: "sk-secret" } } });
    await r.done;
    expect(r.spawnImpl).toHaveBeenCalledWith("/opt/homebrew/bin/goose", ["run", "--text", "hi"], expect.objectContaining({ cwd: "/tmp" }));
  });

  it("exits with Goose's code only once its output has drained", async () => {
    const r = rig({ ok: true, body: { env: { ANTHROPIC_API_KEY: "sk-secret" } } });
    await r.done;
    r.proc.stdout.emit("data", Buffer.from('{"type":"complete"} sk-secret\n'));
    r.proc.emit("close", 0, null);
    expect(r.exit).not.toHaveBeenCalled();
    r.stdout.drain();
    r.stderr.drain();
    expect(r.exit).toHaveBeenCalledWith(0);
    expect(r.stdout.text()).toContain('{"type":"complete"}');
    expect(r.stdout.text()).not.toContain("sk-secret");
  });

  it("logs how Goose ended, with names but never values, and names a signal that stopped it", async () => {
    const r = rig({ ok: true, body: { env: { ANTHROPIC_API_KEY: "sk-secret" } } });
    await r.done;
    r.proc.stderr.emit("data", Buffer.from("boom sk-secret\n"));
    r.proc.emit("close", null, "SIGKILL");
    expect(r.log).toHaveBeenCalledWith("/tmp/goose-root", expect.objectContaining({ program: "/opt/homebrew/bin/goose", cwd: "/tmp", keys: ["ANTHROPIC_API_KEY"], code: null, signal: "SIGKILL" }));
    expect(JSON.stringify(r.log.mock.calls)).not.toContain("sk-secret");
    expect(r.stderr.text()).toContain("Goose was stopped by SIGKILL.");
    r.stdout.drain();
    r.stderr.drain();
    expect(r.exit).toHaveBeenCalledWith(1);
  });

  it("writes the launch log under the state root, and skips it without one", async () => {
    const { writeLaunchLog } = await import("./goose-env.cjs");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "goose-log-"));
    writeLaunchLog(root, { code: 1 });
    writeLaunchLog(undefined, { code: 1 });
    const lines = fs.readFileSync(path.join(root, "state", "weft-launch.log"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ code: 1 });
  });

  it("says why when the grant can't be claimed, and exits after the line is written", async () => {
    const r = rig({ ok: false, body: { error: "grant expired" } });
    await r.done;
    expect(r.stderr.text()).toContain("grant expired");
    expect(r.exit).not.toHaveBeenCalled();
    r.stderr.drain();
    expect(r.exit).toHaveBeenCalledWith(1);
  });

  it("says why when Goose can't be started", async () => {
    const r = rig({ ok: true, body: { env: {} } });
    await r.done;
    r.proc.emit("error", new Error("spawn run ENOENT"));
    expect(r.stderr.text()).toContain("spawn run ENOENT");
    r.stderr.drain();
    expect(r.exit).toHaveBeenCalledWith(1);
  });
});
