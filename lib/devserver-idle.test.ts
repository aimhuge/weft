import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// idleStop and startDev's restart of an idle-stopped run (lib/devserver.ts), beside lib/devserver.test.ts (at its line
// cap). spawn hands back a fake child; process.kill is stubbed, so nothing really starts or gets signalled.
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
  constructor(public pid: number) {
    super();
  }
}

const children: FakeChild[] = [];
const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("./secret-run", () => ({ devSecrets: () => Promise.resolve({}) }));
vi.mock("./env", () => ({ cliEnv: () => ({ PATH: "/bin" }) }));
vi.mock("./store", () => ({ getCard: () => undefined }));
vi.mock("./explore", () => ({ recordExplore: () => Promise.resolve() }));

// The module's exit hook stops every run: kept off the real process, so a fake pid never gets a real signal.
const realOn = process.on.bind(process);
vi.spyOn(process, "on").mockImplementation(((event: string, fn: () => void) => (event === "exit" ? process : realOn(event, fn))) as typeof process.on);

const dev = await import("./devserver");
const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

let nextPid = 5000;
beforeEach(() => {
  dev.runs.clear();
  children.length = 0;
  spawn.mockReset().mockImplementation(() => {
    const child = new FakeChild(++nextPid);
    children.push(child);
    return child;
  });
  kill.mockClear();
});

afterEach(() => dev.runs.clear());

const last = () => children[children.length - 1]!;

describe("idleStop", () => {
  it("does nothing for a card with no server, or one that already exited", async () => {
    dev.idleStop("nobody");
    await dev.startDev("a", "npm run dev", "/app");
    last().emit("exit", 0);
    dev.idleStop("a");
    expect(dev.runs.get("a")?.idleStopped).toBeUndefined();
    expect(kill).not.toHaveBeenCalled();
  });

  it("ends the server's process group but keeps its run, marked, with a line in its log", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    const child = last();
    dev.idleStop("a");
    expect(kill).toHaveBeenCalledWith(-child.pid, "SIGTERM");
    const run = dev.runs.get("a");
    expect(run?.idleStopped).toBe(true);
    expect(run?.log).toMatch(/Stopped by Weft after 30 minutes with no visitors/);
  });

  it("keeps the log under LOG_LIMIT", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    last().stdout.emit("data", Buffer.from("x".repeat(dev.LOG_LIMIT)));
    dev.idleStop("a");
    const log = dev.runs.get("a")?.log ?? "";
    expect(log).toHaveLength(dev.LOG_LIMIT);
    expect(log.endsWith("it starts again on demand.")).toBe(true);
  });

  it("lets startDev bring an idle-stopped server back with the same command", async () => {
    await dev.startDev("a", "npm run dev", "/app");
    dev.idleStop("a");
    await dev.startDev("a", "npm run dev", "/app");
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(dev.runs.get("a")?.idleStopped).toBeUndefined();
  });
});

