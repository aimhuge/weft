// The fake simulator tools the device tests share (lib/simulator-devices.test.ts and
// lib/simulator-devices-actions.test.ts). Nothing here touches a real device: the command runner and the
// process spawner are fakes, and the files the code reads live in a temp dir.
//   const state = vi.hoisted(() => simState());
//   vi.mock("./simulator-exec", async () => (await import("./simulator-devices.harness")).execMock(state));
//   vi.mock("node:child_process", async () => (await import("./simulator-devices.harness")).childMock(state));
import { vi } from "vitest";

// The tools the fakes pretend to have found, and whether each one is there.
export function simState() {
  return {
    bins: { xcrun: "/usr/bin/xcrun", axe: null, adb: "/sdk/adb", emulator: "/sdk/emulator" } as Record<string, string | null>,
    run: vi.fn<(name: string, args: string[], opts?: unknown) => Promise<Buffer>>(),
    runText: vi.fn<(name: string, args: string[], opts?: unknown) => Promise<string>>(),
    spawn: vi.fn<(...args: unknown[]) => unknown>(),
    // What the spawn fake reports back: "close" ends the child, "error" fails it.
    spawnEvent: "close" as "close" | "error",
  };
}

export type Sim = ReturnType<typeof simState>;

// The mock of lib/simulator-exec: the tools are found or missing, the commands answer what the test says.
export function execMock(state: Sim) {
  return {
    bins: () => state.bins,
    binPath: (name: string) => {
      const file = state.bins[name];
      if (!file) throw new Error(`missing ${name}`);
      return file;
    },
    run: (name: string, args: string[], opts?: unknown) => state.run(name, args, opts),
    runText: (name: string, args: string[], opts?: unknown) => state.runText(name, args, opts),
    shellQuote: (value: string) => `'${value.replace(/'/g, `'\\''`)}'`,
    sleep: () => Promise.resolve(),
  };
}

// The mock of node:child_process: the spawned child ends right away, and remembers that it was started.
export function childMock(state: Sim) {
  return {
    spawn: (...args: unknown[]) => {
      state.spawn(...args);
      const child = {
        on(event: string, cb: () => void) {
          if (event === state.spawnEvent) cb();
          return child;
        },
        unref: () => child,
      };
      return child;
    },
  };
}

// The answers the fakes give: a key of the command and its first few arguments, e.g. "adb -s emulator-5554
// logcat" answers every logcat on that device. A command with no answer fails, so a test says only what it
// cares about.
export type Replies = Record<string, string | Buffer>;

export function replyOf(map: Replies, name: string, args: string[]): string | Buffer {
  const key = `${name} ${args.join(" ")}`;
  const prefix = Object.keys(map).find((k) => key.startsWith(`${k} `));
  const hit = map[key] ?? map[name] ?? (prefix === undefined ? undefined : map[prefix]);
  if (hit === undefined) throw new Error(`unexpected ${key}`);
  return hit;
}

// Make the fakes answer by command, so each test states only what it cares about.
export function replies(state: Sim, map: Replies) {
  state.runText.mockImplementation((name, args) => Promise.resolve(String(replyOf(map, name, args))));
  state.run.mockImplementation((name, args) => {
    const hit = replyOf(map, name, args);
    return Promise.resolve(Buffer.isBuffer(hit) ? hit : Buffer.from(hit));
  });
}
