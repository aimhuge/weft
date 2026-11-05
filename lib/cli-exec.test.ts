import { beforeEach, describe, expect, it, vi } from "vitest";

// The CLI runner every connector uses: find a command on PATH, run it, hear what it said. Nothing real is
// touched: node:child_process is faked, so the tests pin the runner's own decisions.

type Callback = (err: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void;

const cp = vi.hoisted(() => ({
  execFile: vi.fn<(file: string, args: string[], opts: unknown, cb: Callback) => void>(),
  execFileSync: vi.fn<(file: string, args: string[], opts: unknown) => string>(),
  // What the next call answers with.
  answer: { stdout: "", stderr: "", error: null as Error | null, sync: "/usr/local/bin/tool" },
  // What the child gets on stdin.
  stdin: [] as string[],
}));

vi.mock("node:child_process", () => ({
  execFile: (file: string, args: string[], opts: unknown, cb: Callback) => {
    cp.execFile(file, args, opts, cb);
    cb(cp.answer.error, cp.answer.stdout, cp.answer.stderr);
    return { stdin: { end: (input: string) => cp.stdin.push(input) } };
  },
  execFileSync: (file: string, args: string[], opts: unknown) => {
    cp.execFileSync(file, args, opts);
    if (cp.answer.error) throw cp.answer.error;
    return cp.answer.sync;
  },
}));

const { runCli, runCliBuffer, runCliText, whichBin } = await import("./cli-exec");

beforeEach(() => {
  cp.execFile.mockClear();
  cp.execFileSync.mockClear();
  cp.stdin = [];
  cp.answer = { stdout: "", stderr: "", error: null, sync: "/usr/local/bin/tool" };
});

describe("whichBin", () => {
  it("is the path the lookup found", () => {
    cp.answer.sync = "/usr/local/bin/gog\n";
    expect(whichBin("gog")).toBe("/usr/local/bin/gog");
    expect(cp.execFileSync).toHaveBeenCalledWith("/usr/bin/which", ["gog"], expect.objectContaining({ encoding: "utf8" }));
  });

  it("looks in the environment it is given", () => {
    whichBin("gog", { env: { PATH: "/opt/bin" } as unknown as NodeJS.ProcessEnv });
    expect(cp.execFileSync).toHaveBeenCalledWith("/usr/bin/which", ["gog"], expect.objectContaining({ env: { PATH: "/opt/bin" } }));
  });

  it("is null when the command isn't there", () => {
    cp.answer.error = new Error("not found");
    expect(whichBin("gog")).toBeNull();
  });

  it("is null when the lookup says nothing", () => {
    cp.answer.sync = "  \n";
    expect(whichBin("gog")).toBeNull();
  });
});

describe("runCli", () => {
  it("is the tool's stdout", async () => {
    cp.answer.stdout = "hello";
    await expect(runCli("/bin/tool", ["say"])).resolves.toBe("hello");
    expect(cp.execFile).toHaveBeenCalledWith("/bin/tool", ["say"], expect.objectContaining({ timeout: undefined }), expect.any(Function));
  });

  it("passes the timeout, the env and the input along", async () => {
    cp.answer.stdout = "ok";
    await runCli("/bin/tool", ["say"], { timeout: 5000, env: { PATH: "/bin" } as unknown as NodeJS.ProcessEnv, input: "text" });
    expect(cp.execFile).toHaveBeenCalledWith("/bin/tool", ["say"], expect.objectContaining({ timeout: 5000, env: { PATH: "/bin" } }), expect.any(Function));
    expect(cp.stdin).toEqual(["text"]);
  });

  it("rejects with what the tool said on stderr", async () => {
    cp.answer.error = new Error("exit 1");
    cp.answer.stderr = "device not found";
    await expect(runCli("/bin/tool", ["boot"])).rejects.toThrow("device not found");
  });

  it("says what the tool printed on stdout when it said nothing on stderr", async () => {
    cp.answer.error = new Error("exit 1");
    cp.answer.stdout = "the reason";
    await expect(runCli("/bin/tool", ["boot"])).rejects.toThrow("the reason");
  });

  it("keeps the process's message when the tool said nothing at all", async () => {
    cp.answer.error = new Error("spawn ENOENT");
    await expect(runCli("/bin/tool", ["boot"])).rejects.toThrow("spawn ENOENT");
  });

  it("names the tool when it is given a name and the tool said nothing", async () => {
    cp.answer.error = new Error("spawn ENOENT");
    await expect(runCli("/bin/tool", ["boot"], { name: "tool" })).rejects.toThrow("tool boot failed: spawn ENOENT");
  });

  it("names the tool without an argument when it was given none", async () => {
    cp.answer.error = new Error("boom");
    await expect(runCli("/bin/tool", [], { name: "tool" })).rejects.toThrow("tool  failed: boom");
  });
});

describe("runCliText", () => {
  it("is the tool's stdout as text", async () => {
    cp.answer.stdout = "hello";
    await expect(runCliText("/bin/tool", ["say"])).resolves.toBe("hello");
    expect(cp.execFile).toHaveBeenCalledWith("/bin/tool", ["say"], expect.objectContaining({ encoding: "utf8" }), expect.any(Function));
  });
});

describe("runCliBuffer", () => {
  it("is the tool's stdout as bytes", async () => {
    cp.answer.stdout = Buffer.from([1, 2, 3]) as unknown as string;
    const out = await runCliBuffer("/bin/tool", ["shot"]);
    expect(out).toEqual(Buffer.from([1, 2, 3]));
    expect(cp.execFile).toHaveBeenCalledWith("/bin/tool", ["shot"], expect.objectContaining({ encoding: "buffer" }), expect.any(Function));
  });

  it("turns text into bytes when the tool answered with text", async () => {
    cp.answer.stdout = "plain";
    const out = await runCliBuffer("/bin/tool", ["shot"]);
    expect(out).toEqual(Buffer.from("plain"));
  });
});
