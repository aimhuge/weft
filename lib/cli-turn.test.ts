// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseJsonLine, readJsonLines, readLines, runCliTurn, unfinishedTurn, type CliTurn } from "./cli-turn";
import type { Session } from "./runner-state";

// The spawned CLI: piped stdin/stdout, a close event and a stderr tail, as lib/cli-process.ts's spawnCli gives back.
class FakeProc extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  tail = "";
  stderrTail = () => this.tail;
}

const spawned = vi.hoisted(() => ({ procs: [] as unknown[], options: [] as unknown[], loggers: [] as unknown[] }));

vi.mock("./cli-process", () => ({
  spawnCli: (options: unknown, onStderr: unknown) => {
    const proc = new FakeProc();
    spawned.procs.push(proc);
    spawned.options.push(options);
    spawned.loggers.push(onStderr);
    return proc;
  },
}));
vi.mock("./cli-messages", () => ({ stderrLogger: () => "logger" }));

const stream = (lines: string[]) => {
  const out = new PassThrough();
  for (const line of lines) out.write(`${line}\n`);
  out.end();
  return out;
};

const session = () => ({ cardId: "card-1", spec: { cwd: "/tmp/card" }, abort: new AbortController() }) as unknown as Session;

/** Runs a turn whose process prints these lines and closes with this exit. */
function turn(s: Session, lines: string[], exit: { code: number | null; signal?: NodeJS.Signals | null }, extra: Partial<CliTurn> = {}, tail = "") {
  const read = vi.fn((stdout: NodeJS.ReadableStream) => readLines(stdout, (line) => line === "END"));
  const running = runCliTurn(s, { name: "Tool", command: "/bin/tool", args: ["run"], env: { A: "1" }, stdin: "prompt", read, ...extra });
  const proc = spawned.procs.at(-1) as FakeProc;
  proc.tail = tail;
  for (const line of lines) proc.stdout.write(`${line}\n`);
  proc.stdout.end();
  proc.emit("close", exit.code, exit.signal ?? null);
  return { running, proc, read };
}

beforeEach(() => {
  spawned.procs.length = 0;
  spawned.options.length = 0;
  spawned.loggers.length = 0;
});

describe("readLines", () => {
  it("hands every non-blank line on, and says whether any finished the turn", async () => {
    const seen: string[] = [];
    expect(await readLines(stream(["a", "  ", "", "b"]), (line) => {
      seen.push(line);
      return false;
    })).toBe(false);
    expect(seen).toEqual(["a", "b"]);
    expect(await readLines(stream(["a", "END", "c"]), (line) => Promise.resolve(line === "END"))).toBe(true);
  });
});

describe("parseJsonLine", () => {
  it("is the line's object, and undefined for noise", () => {
    expect(parseJsonLine('{"type":"x"}')).toEqual({ type: "x" });
    expect(parseJsonLine("not json")).toBeUndefined();
    expect(parseJsonLine("null")).toBeUndefined();
    expect(parseJsonLine("3")).toBeUndefined();
  });
});

describe("readJsonLines", () => {
  it("hands each JSON object on and skips blank and non-JSON lines", async () => {
    const seen: unknown[] = [];
    const done = await readJsonLines(stream(['{"n":1}', "noise", "  ", '{"n":2}']), (event) => {
      seen.push(event);
      return event.n === 2;
    });
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
    expect(done).toBe(true);
  });
});

describe("unfinishedTurn", () => {
  it("is what the CLI said, or how it exited", () => {
    expect(unfinishedTurn("Tool", { code: 1, signal: null }, "boom").message).toBe("boom");
    expect(unfinishedTurn("Tool", { code: 2, signal: null }, "").message).toBe("Tool exited with code 2 without finishing the turn.");
    expect(unfinishedTurn("Tool", { code: null, signal: "SIGKILL" }, "").message).toBe("Tool exited on SIGKILL without finishing the turn.");
    expect(unfinishedTurn("Tool", { code: null, signal: null }, "").message).toBe("Tool exited with code unknown without finishing the turn.");
  });
});

describe("runCliTurn", () => {
  it("starts the CLI in the card's folder on the session's signal, feeds stdin and resolves once the turn finished", async () => {
    const s = session();
    const { running, proc, read } = turn(s, ["hello", "END"], { code: 0 });
    await expect(running).resolves.toBeUndefined();
    expect(spawned.options[0]).toEqual({ command: "/bin/tool", args: ["run"], cwd: "/tmp/card", env: { A: "1" }, signal: s.abort.signal });
    expect(spawned.loggers[0]).toBe("logger");
    expect(s.process).toBe(proc);
    expect(read).toHaveBeenCalledWith(proc.stdout);
    expect((proc.stdin.read() as Buffer).toString()).toBe("prompt");
  });

  it("swallows an error on stdin (the CLI closed it early)", async () => {
    const { running, proc } = turn(session(), ["END"], { code: 0 });
    expect(() => proc.stdin.emit("error", new Error("EPIPE"))).not.toThrow();
    await expect(running).resolves.toBeUndefined();
  });

  it("throws the spawn error, even after a finished turn", async () => {
    const s = session();
    const running = runCliTurn(s, { name: "Tool", command: "/bin/tool", args: [], env: {}, stdin: "", read: (out) => readLines(out, () => true) });
    const proc = spawned.procs.at(-1) as FakeProc;
    proc.emit("error", new Error("spawn ENOENT"));
    proc.stdout.end("END\n");
    proc.emit("close", null, null);
    await expect(running).rejects.toThrow("spawn ENOENT");
  });

  it("fails a turn that never finished with the stderr tail, or how the CLI exited", async () => {
    const first = turn(session(), ["hello"], { code: 1 }, {}, "rate limited");
    await expect(first.running).rejects.toThrow("rate limited");
    const second = turn(session(), [], { code: null, signal: "SIGTERM" });
    await expect(second.running).rejects.toThrow("Tool exited on SIGTERM without finishing the turn.");
  });

  it("lets the adapter word the error from the stderr tail", async () => {
    const explain = vi.fn((tail: string) => Promise.resolve(`explained: ${tail || "nothing"}`));
    const { running } = turn(session(), [], { code: 1 }, { explain });
    await expect(running).rejects.toThrow("explained: nothing");
    expect(explain).toHaveBeenCalledWith("");
  });

  it("says nothing when the session was aborted mid-turn", async () => {
    const s = session();
    s.abort.abort();
    const { running } = turn(s, [], { code: null, signal: "SIGTERM" });
    await expect(running).resolves.toBeUndefined();
  });
});
