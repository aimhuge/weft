// The fake `gog` CLI the gog tests share (lib/gog.test.ts, lib/gog-signin.test.ts). A test file makes
// the shared state with vi.hoisted (cpState) and hands it to the mock factories the harness exports:
//   vi.mock("node:child_process", async () => (await import("./gog.harness")).childProcessMock(cp));
import { EventEmitter } from "node:events";
import { vi } from "vitest";

export type Callback = (err: Error | null, stdout: string, stderr: string) => void;

// A stand-in for a `gog` child process: tests push output and exits through its emitters.
export class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
  kill = vi.fn();
}

// The shared state of the fake CLI. Each test scripts how `gog` answers a given argument list.
export function cpState() {
  return {
    which: vi.fn<(file: string, args: string[]) => string>(),
    execFile: vi.fn<(file: string, args: string[], opts: unknown, cb: Callback) => void>(),
    spawn: vi.fn<(...args: unknown[]) => FakeChild>(),
    children: [] as FakeChild[],
    // What each run() call wrote to the child's stdin.
    stdin: [] as string[],
    answers: new Map<string, string>(),
    failures: new Map<string, Error>(),
    // A failure whose stderr is blank, so the caller falls back to the process's own message.
    quietFailures: new Set<string>(),
    // Answers the test holds back: the first call for a key waits for its release, the rest answer
    // straight away. A test uses it to let two calls overlap.
    delays: new Map<string, { gate: Promise<void> }>(),
  };
}

export type Cp = ReturnType<typeof cpState>;

// The mocks the test files wire into vi.mock.
export function childProcessMock(cp: Cp) {
  return {
    execFileSync: (file: string, args: string[]) => cp.which(file, args),
    execFile: (file: string, args: string[], opts: unknown, cb: Callback) => {
      cp.execFile(file, args, opts, cb);
      const key = args.join(" ");
      const delay = cp.delays.get(key);
      // The first call for a held-back key waits for the test to release it.
      if (delay) {
        cp.delays.delete(key);
        void delay.gate.then(() => cb(null, cp.answers.get(key) ?? "", ""));
        return { stdin: { end: (input: string) => cp.stdin.push(input) } };
      }
      const failure = cp.failures.get(key);
      if (failure) cb(failure, "", cp.quietFailures.has(key) ? "" : failure.message);
      else cb(null, cp.answers.get(key) ?? "", "");
      return { stdin: { end: (input: string) => cp.stdin.push(input) } };
    },
    spawn: (...args: unknown[]) => cp.spawn(...args),
  };
}

// The CLI env lib/gog.ts gives every gog process.
export function envMock() {
  return { cliEnv: () => ({ PATH: "/usr/bin" }) };
}

// Puts the fake CLI back to its starting state and imports lib/gog.ts afresh, so each test starts
// with a clean singleton and a clean PATH.
export async function loadGog(cp: Cp) {
  vi.resetModules();
  delete (globalThis as { __weftGog?: unknown }).__weftGog;
  cp.answers = new Map();
  cp.failures = new Map();
  cp.quietFailures = new Set();
  cp.delays = new Map();
  cp.children = [];
  cp.stdin = [];
  cp.which.mockReset().mockImplementation(() => "/usr/local/bin/gog\n");
  cp.execFile.mockReset();
  cp.spawn.mockReset().mockImplementation(() => {
    const c = new FakeChild();
    cp.children.push(c);
    return c;
  });
  return await import("./gog");
}

// The child process the last spawn() made.
export function child(cp: Cp): FakeChild {
  const last = cp.children.at(-1);
  if (!last) throw new Error("No gog process was started.");
  return last;
}

// How `gog` answers a given argument list.
export function says(cp: Cp, args: string, stdout: string) {
  cp.answers.set(args, stdout);
}

// Holds the next answer for a given argument list back, so a test can let two calls overlap. The
// returned function releases it.
export function holds(cp: Cp, args: string, stdout: string): () => void {
  says(cp, args, stdout);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  cp.delays.set(args, { gate });
  return release;
}

// The OAuth clients gog has stored: the names it answers `auth credentials list --json` with.
// A sign-in picks the user's own client when there is one, else Weft's own.
export function hasClient(cp: Cp, client: string) {
  says(cp, "auth credentials list --json", JSON.stringify({ clients: [{ client }] }));
}

// The state lib/gog.ts keeps on globalThis, read directly so the tests can see it.
export function gogState(): { adding: { email: string } | null; lastError: string | null } {
  return (globalThis as unknown as { __weftGog: { adding: { email: string } | null; lastError: string | null } }).__weftGog;
}
