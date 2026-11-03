import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

// openAdbScreen with nothing handed in: the SDK's adb, node's spawn and `wm size` through the simulator tools.
const exec = vi.hoisted(() => ({ bins: vi.fn(() => ({ adb: "/sdk/adb" })), runText: vi.fn(() => Promise.resolve("Physical size: 100x200")) }));
const cp = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("./simulator-exec", async (actual) => ({ ...(await actual<typeof import("./simulator-exec")>()), ...exec }));
vi.mock("node:child_process", () => cp);

const { openAdbScreen } = await import("./adb-screen");

describe("openAdbScreen's own tools", () => {
  it("finds adb, reads the size and opens the shell", async () => {
    cp.spawn.mockReturnValue(Object.assign(new EventEmitter(), { stdin: new PassThrough(), kill: vi.fn() }));
    const s = await openAdbScreen("emulator-5554");
    expect(s?.size).toEqual({ width: 100, height: 200 });
    expect(exec.runText).toHaveBeenCalledWith("adb", ["-s", "emulator-5554", "shell", "wm", "size"], { timeout: 10_000 });
    expect(cp.spawn).toHaveBeenCalledWith("/sdk/adb", ["-s", "emulator-5554", "shell"], { stdio: ["pipe", "ignore", "ignore"] });
    s?.close();
  });
});
