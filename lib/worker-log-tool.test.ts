// mcp__board__worker_log (lib/worker-log-tool.ts): the end of a Weft Worker's log for a thread, with the box's own
// tokens taken out by value and anything key-shaped hidden.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REDACTED } from "./share-redact";

vi.mock("./worker-secret-wiring", () => ({ keyStatus: () => ["Box key fingerprint: ab12"] }));

const { heldTokens, LOG_LINES, LOG_LINES_MAX, redactLine, tailLog, workerLog, workerLogTool } = await import("./worker-log-tool");

const KEY = "wwk_0123456789abcdef";
const MAC = {} as NodeJS.ProcessEnv;
const WORKER: NodeJS.ProcessEnv = { ...MAC, WEFT_WORKER: "1" };
let home: string;

const enrol = () =>
  fs.writeFileSync(path.join(home, "worker.json"), JSON.stringify({ workerId: "w1", orgId: "org1", ownerUser: "u1", device: "worker:w1", key: KEY, name: "m1mini" }));
const log = (text: string) => fs.writeFileSync(path.join(home, "worker.log"), text);

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-worker-log-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("heldTokens", () => {
  it("collects the worker's key, the Claude token and each GitHub token, and drops what's too short to be one", () => {
    enrol();
    fs.writeFileSync(path.join(home, "github-credentials"), "https://me:gho_abc%2Fdef12345@github.com\nnot a credential line\nhttps://me:short@github.com\n");
    expect(heldTokens(home, { ...MAC, CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-zzzzzzzz" })).toEqual([KEY, "sk-ant-oat01-zzzzzzzz", "gho_abc/def12345"]);
  });

  it("has none on a box that isn't enrolled or signed in", () => {
    expect(heldTokens(home, MAC)).toEqual([]);
  });
});

describe("redactLine", () => {
  it("hides a held token wherever it sits, and cuts a long line", () => {
    expect(redactLine(`key=${KEY} again ${KEY}`, [KEY])).toBe(`key=${REDACTED} again ${REDACTED}`);
    const long = redactLine("x ".repeat(400), []);
    expect(long).toHaveLength(401);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("tailLog", () => {
  it("gives the last lines, redacted, without the empty one a trailing newline leaves", () => {
    log(`one\ntwo ${KEY}\nthree\n`);
    expect(tailLog(path.join(home, "worker.log"), 2, [KEY])).toBe(`two ${REDACTED}\nthree`);
  });

  it("reads only the end of a big log and drops the line the window cut", () => {
    const line = `${"y".repeat(99)}\n`;
    log(`${line.repeat(3_000)}last`);
    const out = tailLog(path.join(home, "worker.log"), 10_000, []).split("\n");
    expect(out.at(-1)).toBe("last");
    expect(out.length).toBeLessThan(3_000);
    // The first line kept is whole.
    expect(out[0]).toBe("y".repeat(99));
  });
});

describe("workerLog", () => {
  it("only answers on a Weft Worker", () => {
    expect(() => workerLog(10, home, MAC)).toThrow(/only works on a Weft Worker/);
  });

  it("says who the box is, then that there's no log yet", () => {
    expect(workerLog(10, home, WORKER)).toMatch(/^Not enrolled\.\n\nThis worker has no worker\.log yet/);
    enrol();
    expect(workerLog(10, home, WORKER)).toMatch(/^Enrolled: m1mini \(worker:w1\), workspace org1\nBox key fingerprint: ab12\n\nThis worker has no worker\.log yet/);
  });

  it("gives the status and the last lines with the box's key hidden, within the limit", () => {
    enrol();
    log(Array.from({ length: 400 }, (_, i) => `line ${i} ${KEY}`).join("\n"));
    const few = workerLog(2.9, home, WORKER);
    expect(few).toContain("worker.log, last 2 lines:\n");
    expect(few.endsWith(`line 398 ${REDACTED}\nline 399 ${REDACTED}`)).toBe(true);
    expect(few).not.toContain(KEY);
    expect(workerLog(0, home, WORKER)).toContain("last 1 lines:");
    expect(workerLog(10_000, home, WORKER)).toContain(`last ${LOG_LINES_MAX} lines:`);
    expect(workerLog(undefined, home, WORKER)).toContain(`last ${LOG_LINES} lines:`);
  });

  it("says so when the log is empty", () => {
    log("");
    expect(workerLog(5, home, WORKER).endsWith("(empty)")).toBe(true);
  });
});

describe("the worker_log tool", () => {
  const call = async (args: { lines?: number }) => (await workerLogTool().handler(args as never, {})) as { content: { text: string }[]; isError?: boolean };

  it("answers with the log on a worker, and with why not anywhere else", async () => {
    vi.stubEnv("WEFT_WORKER_HOME", home);
    vi.stubEnv("WEFT_WORKER", "1");
    log("started\n");
    const on = await call({ lines: 5 });
    expect(on.isError).toBeUndefined();
    expect(on.content[0]?.text).toContain("worker.log, last 5 lines:\nstarted");
    vi.stubEnv("WEFT_WORKER", "");
    const off = await call({});
    expect(off.isError).toBe(true);
    expect(off.content[0]?.text).toMatch(/only works on a Weft Worker/);
  });
});
