import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoginView } from "./types";

// noteTrial: why Weft's Puku trial didn't cover a login, noted on the login in progress.

const bus = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
  spawn: () => Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: new EventEmitter(), pid: 1, kill: vi.fn() }),
  execFile: vi.fn(),
}));
vi.mock("./cli-exec", () => ({ whichBin: () => "/usr/local/bin/puku-cli" }));
vi.mock("./bus", () => ({ publish: bus.publish }));

let login: typeof import("./login");

beforeEach(async () => {
  vi.resetModules();
  delete (globalThis as { __weftLogins?: unknown }).__weftLogins;
  bus.publish.mockReset();
  login = await import("./login");
});

describe("noteTrial", () => {
  it("does nothing without a login in progress", () => {
    login.noteTrial("puku", { reason: "signed-out", message: "Sign in" });
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it("notes why the trial didn't cover the login and publishes it", () => {
    login.startLogin("puku");
    bus.publish.mockClear();
    login.noteTrial("puku", { reason: "unavailable", message: "offline" });
    const view = (bus.publish.mock.calls.at(-1)![0] as { login: LoginView }).login;
    expect(view).toMatchObject({ backend: "puku", state: "running", trial: { reason: "unavailable", message: "offline" } });
  });
});
