import { describe, expect, it } from "vitest";
import { findUntracked, type Inputs } from "./dev-untracked";

const APP = "/Users/me/dev/app";
const WEFT = "/Users/me/dev/weft";

// A terminal's `pnpm dev` in app: zsh → pnpm → sh -c → node next dev → next-server listening on 4002.
const procs = [
  { pid: 10, ppid: 1, command: "-zsh" },
  { pid: 20, ppid: 10, command: "node /opt/homebrew/bin/pnpm dev" },
  { pid: 30, ppid: 20, command: "sh -c next dev -p 4002" },
  { pid: 40, ppid: 30, command: "node /Users/me/dev/app/node_modules/.bin/next dev -p 4002" },
  { pid: 50, ppid: 40, command: "next-server (v16.4.5)" },
  { pid: 51, ppid: 50, command: "node worker.js" },
  // Weft's own server, in its own folder on its own port.
  { pid: 900, ppid: 899, command: "next-server (v16.4.5)" },
  { pid: 899, ppid: 1, command: "node /Users/me/dev/weft/node_modules/.bin/next dev -p 1024" },
  // Something that listens but isn't a dev server.
  { pid: 60, ppid: 1, command: "node /Users/me/dev/app/scripts/socket.js" },
  // A thread's CLI starting a server in its Bash.
  { pid: 70, ppid: 900, command: "claude --resume abc" },
  { pid: 71, ppid: 70, command: "/bin/zsh -c -l eval 'vite'" },
  { pid: 72, ppid: 71, command: "node /Users/me/dev/app/node_modules/.bin/vite" },
];

const base = (over: Partial<Inputs> = {}): Inputs => ({
  procs,
  listening: new Map([
    [50, [4002]],
    [900, [1024]],
    [60, [7000]],
    [72, [5173]],
  ]),
  cwds: new Map([
    [50, APP],
    [900, WEFT],
    [60, APP],
    [72, `${APP}/web`],
  ]),
  folders: [APP, WEFT],
  tracked: new Set(),
  weft: new Set([900, 899]),
  self: { dir: WEFT, port: 1024 },
  ...over,
});

describe("findUntracked", () => {
  it("finds a terminal's dev server up to its launcher, and a thread's up to its shell", () => {
    const found = findUntracked(base());
    expect(found.map((u) => u.key)).toEqual(["untracked:20", "untracked:71"]);
    expect(found[0]).toEqual({ key: "untracked:20", root: 20, pids: [20, 30, 40, 50, 51], ports: [4002], cwd: APP, command: "node /opt/homebrew/bin/pnpm dev" });
    expect(found[1]?.pids).toEqual([71, 72]);
  });

  it("never lists Weft itself, tracked runs, or folders off the board", () => {
    expect(findUntracked(base({ tracked: new Set([50, 72]) }))).toEqual([]);
    expect(findUntracked(base({ folders: [WEFT] }))).toEqual([]);
    // Weft's next-server by folder and port, even with an unknown pid.
    expect(findUntracked(base({ weft: new Set(), listening: new Map([[900, [1024]]]) }))).toEqual([]);
  });

  it("skips a listener without a cwd or a ps row", () => {
    expect(findUntracked(base({ cwds: new Map() }))).toEqual([]);
    expect(findUntracked(base({ listening: new Map([[999, [1]]]), cwds: new Map([[999, APP]]) }))).toEqual([]);
  });

  it("joins two listeners under one launcher", () => {
    const found = findUntracked(base({ listening: new Map([[50, [4002]], [51, [4003]]]), cwds: new Map([[50, APP], [51, APP]]) }));
    expect(found).toHaveLength(1);
    expect(found[0]?.ports).toEqual([4002, 4003]);
  });

  it("doesn't take a listening Electron or CLI for a dev server", () => {
    const electron = [{ pid: 80, ppid: 1, command: "/Applications/Weft.app/Contents/MacOS/Weft next dev" }];
    expect(findUntracked(base({ procs: electron, listening: new Map([[80, [3000]]]), cwds: new Map([[80, APP]]) }))).toEqual([]);
  });
});
