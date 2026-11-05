import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { children, FakeChild, lastChild, ports, resetChildren, resetPorts, settle, stubFetch } from "./whisper-server.harness";

// The whisper server (lib/whisper-server.ts) against a fake child process, a fake port and a
// stubbed fetch: nothing is spawned, no port is bound and no request leaves the process.
// The fakes live in ./whisper-server.harness.ts.

const cp = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({
  spawn: cp.spawn,
  default: { spawn: cp.spawn },
}));

vi.mock("node:net", () => {
  const createServer = () => {
    const probe = {
      once: () => probe,
      listen: (_port: number, _host: string, cb: () => void) => {
        // Each probe hands out the next port, so two servers get two ports.
        ports.current = ports.next++;
        cb();
        return probe;
      },
      address: () => ({ port: ports.current }),
      close: (cb: () => void) => {
        cb();
        return probe;
      },
    };
    return probe;
  };
  return { createServer, default: { createServer } };
});

// The module keeps its state on globalThis, so a fresh copy is a fresh state.
async function load() {
  vi.resetModules();
  delete (globalThis as unknown as Record<string, unknown>).weftWhisperServer;
  return import("./whisper-server");
}

let dir: string;
let wav: string;

// Each reload of the module registers a process "exit" listener, and this file reloads it
// once per test, so the default cap of 10 warns. Raise it rather than lose the warning.
beforeAll(() => {
  process.setMaxListeners(100);
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-whisper-server-"));
  wav = path.join(dir, "audio.wav");
  fs.writeFileSync(wav, "RIFFfake");
  resetChildren();
  resetPorts();
  cp.spawn.mockReset();
  cp.spawn.mockImplementation(() => {
    const child = new FakeChild();
    children.push(child);
    return child as never;
  });
  vi.spyOn(os, "availableParallelism").mockReturnValue(4);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
  delete (globalThis as unknown as Record<string, unknown>).weftWhisperServer;
});

const spawnArgs = (n = 0) => (cp.spawn.mock.calls[n] as [string, string[]])[1];

describe("warmServer", () => {
  it("starts one server and shares it with concurrent callers", async () => {
    stubFetch();
    const { warmServer } = await load();

    const a = warmServer("/bin/whisper-server", "ggml-base.bin");
    const b = warmServer("/bin/whisper-server", "ggml-base.bin");
    await settle();

    await expect(a).resolves.toBeDefined();
    await expect(b).resolves.toBeDefined();

    expect(cp.spawn).toHaveBeenCalledTimes(1);
    expect(children).toHaveLength(1);
  });

  it("spawns whisper-server on 127.0.0.1 with the model and a thread count", async () => {
    stubFetch();
    const { warmServer } = await load();
    await warmServer("/bin/whisper-server", "ggml-base.bin");
    await settle();

    const [bin, args, opts] = cp.spawn.mock.calls[0] as [string, string[], { stdio: string }];
    expect(bin).toBe("/bin/whisper-server");
    expect(args).toEqual(["-m", "ggml-base.bin", "--host", "127.0.0.1", "--port", "4321", "-t", "3"]);
    expect(opts).toEqual({ stdio: "ignore" });
  });

  it("keeps between 2 and 8 threads", async () => {
    stubFetch();
    const { warmServer } = await load();
    await warmServer("/bin/whisper-server", "m.bin");
    await settle();
    vi.clearAllMocks();

    vi.spyOn(os, "availableParallelism").mockReturnValue(1);
    await warmServer("/bin/whisper-server", "m2.bin");
    await settle();
    expect(spawnArgs()).toContain("2");

    vi.spyOn(os, "availableParallelism").mockReturnValue(64);
    await warmServer("/bin/whisper-server", "m3.bin");
    await settle();
    expect(spawnArgs(cp.spawn.mock.calls.length - 1)).toContain("8");
  });

  it("reuses the running server for the same model", async () => {
    stubFetch();
    const { warmServer } = await load();
    const first = await warmServer("/bin/whisper-server", "ggml-base.bin");
    await settle();

    const second = await warmServer("/bin/whisper-server", "ggml-base.bin");
    await settle();

    expect(second).toBe(first);
    expect(cp.spawn).toHaveBeenCalledTimes(1);
  });

  it("stops the old server and starts a new one for a different model", async () => {
    stubFetch();
    const { warmServer } = await load();
    await warmServer("/bin/whisper-server", "ggml-base.bin");
    await settle();
    const old = lastChild();

    await warmServer("/bin/whisper-server", "ggml-base2.bin");
    await settle();

    expect(cp.spawn).toHaveBeenCalledTimes(2);
    expect(old.killed).toBe(true);
    expect(spawnArgs(1)).toContain("ggml-base2.bin");
  });

  it("starts a fresh server when the old one has exited", async () => {
    stubFetch();
    const { warmServer } = await load();
    await warmServer("/bin/whisper-server", "ggml-base.bin");
    await settle();
    lastChild().die();

    await warmServer("/bin/whisper-server", "ggml-base.bin");
    await settle();

    expect(cp.spawn).toHaveBeenCalledTimes(2);
  });

  it("rejects and clears the server when the child exits while starting", async () => {
    stubFetch({ ready: false });
    const { warmServer, serverRunning } = await load();
    const pending = warmServer("/bin/whisper-server", "ggml-base.bin");
    const assertion = expect(pending).rejects.toThrow("whisper-server stopped while starting.");
    await settle();
    lastChild().die();

    // The readiness loop notices the exit on its next poll.
    await vi.advanceTimersByTimeAsync(200);

    await assertion;
    expect(serverRunning()).toBe(false);
    // The child already died on its own, so there is nothing left to kill.
    expect(lastChild().exitCode).not.toBeNull();
  });

  it("gives up when the server takes too long to start", async () => {
    stubFetch({ ready: false });
    const { warmServer, serverRunning } = await load();
    const pending = warmServer("/bin/whisper-server", "ggml-base.bin");
    const assertion = expect(pending).rejects.toThrow("whisper-server took too long to start.");
    await settle();

    // 60s of polling, in 200ms steps.
    for (let i = 0; i < 320; i++) {
      await vi.advanceTimersByTimeAsync(200);
    }

    await assertion;
    expect(serverRunning()).toBe(false);
  });

  it("clears the server when the child fails to spawn, and gives up on the next poll", async () => {
    stubFetch({ ready: false });
    const { warmServer, serverRunning } = await load();
    const pending = warmServer("/bin/whisper-server", "ggml-base.bin");
    const assertion = expect(pending).rejects.toThrow("whisper-server stopped while starting.");
    await settle();

    // A spawn failure: the child errors instead of exiting.
    lastChild().emit("error", new Error("spawn ENOENT"));
    expect(serverRunning()).toBe(false);

    // One poll, not the whole 60 s readiness wait.
    await vi.advanceTimersByTimeAsync(400);
    await assertion;
  });

  it("leaves the newer start alone when a superseded start finally settles", async () => {
    // The first server never becomes ready; the second one does. So the first start is
    // still pending when the second replaces it, and its cleanup must not clear the second.
    stubFetch({ readyPort: 4322 });
    const { warmServer } = await load();
    const first = warmServer("/bin/whisper-server", "ggml-base.bin");
    // The second start kills the first child, so the first start gives up.
    const firstAssertion = expect(first).rejects.toThrow(/whisper-server (took too long to start|stopped while starting)/);
    await settle();

    const second = warmServer("/bin/whisper-server", "ggml-base2.bin");
    await settle();
    await expect(second).resolves.toBeDefined();

    // The first start times out, after the second has taken over.
    for (let i = 0; i < 320; i++) {
      await vi.advanceTimersByTimeAsync(200);
    }
    await firstAssertion;

    // The second server is still the running one.
    expect(cp.spawn).toHaveBeenCalledTimes(2);
  });
});

describe("serverTranscribe", () => {
  it("posts the wav as form data and returns the text", async () => {
    const { calls } = stubFetch({ text: "hello there" });
    const { serverTranscribe } = await load();

    const pending = serverTranscribe("/bin/whisper-server", "ggml-base.bin", wav, { language: "en", audioCtx: 1, prompt: "" });
    await settle();
    await vi.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toBe("hello there");

    const inference = calls.find((c) => c.url.endsWith("/inference"))!;
    expect(inference.url).toBe("http://127.0.0.1:4321/inference");
    expect(inference.init?.method).toBe("POST");

    const form = inference.init?.body as FormData;
    expect(form.get("response_format")).toBe("text");
    expect(form.get("language")).toBe("en");
    expect(form.get("no_timestamps")).toBe("true");
    expect(form.get("audio_ctx")).toBe("1");
    // An empty prompt is left out.
    expect(form.get("prompt")).toBeNull();

    const file = form.get("file") as File;
    expect(file.name).toBe("audio.wav");
    expect(file.type).toBe("audio/wav");
    expect(await file.text()).toBe("RIFFfake");
  });

  it("sends the prompt when it is not empty", async () => {
    const { calls } = stubFetch();
    const { serverTranscribe } = await load();

    const pending = serverTranscribe("/bin/whisper-server", "ggml-base.bin", wav, { language: "de", audioCtx: 2, prompt: "Weft" });
    await settle();
    await vi.advanceTimersByTimeAsync(200);
    await pending;

    const form = (calls.find((c) => c.url.endsWith("/inference"))!.init?.body) as FormData;
    expect(form.get("prompt")).toBe("Weft");
    expect(form.get("language")).toBe("de");
    expect(form.get("audio_ctx")).toBe("2");
  });

  it("throws when the server answers with an error", async () => {
    stubFetch({ status: 500 });
    const { serverTranscribe } = await load();

    const pending = serverTranscribe("/bin/whisper-server", "ggml-base.bin", wav, { language: "en", audioCtx: 1, prompt: "" });
    const assertion = expect(pending).rejects.toThrow("whisper-server answered 500.");
    await settle();
    await vi.advanceTimersByTimeAsync(200);

    await assertion;
  });
});

describe("stopServer and serverRunning", () => {
  it("does nothing when no server is running", async () => {
    const { stopServer, serverRunning } = await load();
    expect(serverRunning()).toBe(false);
    expect(() => stopServer()).not.toThrow();
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it("kills the server and clears it", async () => {
    stubFetch();
    const { warmServer, stopServer, serverRunning } = await load();
    await warmServer("/bin/whisper-server", "ggml-base.bin");
    await settle();
    const child = lastChild();
    expect(serverRunning()).toBe(true);

    stopServer();

    expect(child.killed).toBe(true);
    expect(serverRunning()).toBe(false);
  });

  it("stops the server after the idle time with no recording", async () => {
    stubFetch();
    const { warmServer, serverRunning } = await load();
    await warmServer("/bin/whisper-server", "ggml-base.bin");
    await settle();
    const child = lastChild();

    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1_000);
    expect(child.killed).toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(child.killed).toBe(true);
    expect(serverRunning()).toBe(false);
  });

  it("stops the server when Weft quits, so no model is left loaded", async () => {
    stubFetch();
    // Capture the exit handler the module registers, without letting it run on the real exit.
    const onExit = vi.fn();
    const once = vi.spyOn(process, "once").mockImplementation(((event: string, cb: () => void) => {
      if (event === "exit") onExit.mockImplementation(cb);
      return process as never;
    }) as never);

    const { warmServer } = await load();
    await warmServer("/bin/whisper-server", "ggml-base.bin");
    await settle();
    const child = lastChild();
    expect(child.killed).toBe(false);

    // Weft is quitting.
    onExit();

    expect(child.killed).toBe(true);
    once.mockRestore();
  });
});
