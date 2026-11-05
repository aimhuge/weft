// Who is on the other end of the connector socket (lib/connector-peer.ts): lsof's and ss's answers parsed, the parent
// chain walked, and on macOS a real child process found as the peer of a real Unix socket.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { darwinPeer, descendsFrom, fdOf, linuxPeer, parseLsof, parseSs, peerPid, runTool, type Run } from "./connector-peer";

const me = process.pid;
const conn = (fd: unknown) => ({ _handle: { fd } }) as unknown as net.Socket;

describe("parseLsof and darwinPeer", () => {
  const mine = `p${me}\nf14\nd0xaaa\nn/h/connector.sock\n`;
  const all = `p${me}\nf14\nd0xaaa\nn/h/connector.sock\np555\nf3\nd0xbbb\nn->0xaaa\nf4\nd0xccc\nn->0xddd\n`;
  it("reads lsof's fields per file", () => {
    expect(parseLsof(all)).toEqual([
      { pid: me, fd: "14", device: "0xaaa", name: "/h/connector.sock" },
      { pid: 555, fd: "3", device: "0xbbb", name: "->0xaaa" },
      { pid: 555, fd: "4", device: "0xccc", name: "->0xddd" },
    ]);
    expect(parseLsof("dx\nny\n")).toEqual([]);
  });

  it("finds the process whose socket points at ours", async () => {
    const run: Run = (_cmd, args) => Promise.resolve(args.includes("-p") ? mine : all);
    expect(await darwinPeer(14, run)).toBe(555);
    expect(await darwinPeer(14, () => Promise.resolve(""))).toBeNull();
    expect(await darwinPeer(14, (_c, args) => Promise.resolve(args.includes("-p") ? mine : `p${me}\nf9\nd0x1\nn->0xaaa\n`))).toBeNull();
  });
});

describe("parseSs and linuxPeer", () => {
  const ss = [
    `u_str ESTAB 0 0 /h/connector.sock 1001 * 2002 users:(("node",pid=${me},fd=20))`,
    'u_str ESTAB 0 0 * 2002 * 1001 users:(("git-credential",pid=321,fd=3))',
    "u_str ESTAB 0 0 * 3003 * 4004",
  ].join("\n");
  it("reads each socket's inode, its peer's and its process", () => {
    expect(parseSs(ss)).toEqual([
      { inode: "1001", peer: "2002", pid: me },
      { inode: "2002", peer: "1001", pid: 321 },
    ]);
  });

  it("finds the process whose socket's peer is ours", async () => {
    expect(await linuxPeer(20, () => Promise.resolve(ss), () => "socket:[1001]")).toBe(321);
    expect(await linuxPeer(20, () => Promise.resolve(ss), () => "socket:[9999]")).toBeNull();
    expect(await linuxPeer(20, () => Promise.resolve(ss), () => "/dev/null")).toBeNull();
  });
});

describe("peerPid", () => {
  it("needs the connection's fd, a platform it knows and tools that answer", async () => {
    expect(fdOf(conn(7))).toBe(7);
    expect(fdOf(conn(-1))).toBeNull();
    expect(fdOf({} as net.Socket)).toBeNull();
    expect(await peerPid({} as net.Socket)).toBeNull();
    expect(await peerPid(conn(7), { platform: "win32" })).toBeNull();
    expect(await peerPid(conn(7), { platform: "darwin", run: () => Promise.reject(new Error("no lsof")) })).toBeNull();
    expect(await peerPid(conn(7), { platform: "linux", run: () => Promise.reject(new Error("no ss")) })).toBeNull();
  });

  it("runs a tool and rejects when it fails", async () => {
    expect(await runTool("/bin/echo", ["hi"])).toBe("hi\n");
    await expect(runTool("/nonexistent/tool", [])).rejects.toThrow();
  });

  it("finds no peer for a descriptor that isn't a socket of ours, with the real tools", async () => {
    expect(await peerPid(conn(99_999), { platform: "darwin" })).toBeNull();
  });

  it("asks lsof on macOS", async () => {
    const calls: string[] = [];
    await peerPid(conn(7), { platform: "darwin", run: (cmd) => (calls.push(cmd), Promise.resolve("")) });
    expect(calls).toEqual(["lsof"]);
  });

  it.runIf(process.platform === "darwin")("finds a real child process connected to a real socket", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wpeer-"));
    const socket = path.join(dir, "s.sock");
    const seen = new Promise<net.Socket>((resolve) => {
      const server = net.createServer((c) => resolve(c));
      server.listen(socket);
    });
    const child = spawn(process.execPath, ["-e", `require("net").connect(${JSON.stringify(socket)}); setTimeout(() => {}, 5000)`]);
    const c = await seen;
    expect(await peerPid(c)).toBe(child.pid);
    expect(await descendsFrom(child.pid!, me)).toBe(true);
    child.kill();
    c.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("descendsFrom", () => {
  const tree = "  1 0 1\n 10 1 10\n 20 10 20\n 30 20 20\n 40 1 40\n 50 50 50\n";
  const run: Run = () => Promise.resolve(tree);
  it("walks the parent chain up to the ancestor, and no further than init", async () => {
    expect(await descendsFrom(30, 30, run)).toBe(true);
    expect(await descendsFrom(30, 10, run)).toBe(true);
    expect(await descendsFrom(30, 40, run)).toBe(false);
    expect(await descendsFrom(99, 10, run)).toBe(false);
    expect(await descendsFrom(50, 10, run)).toBe(false);
    expect(await descendsFrom(30, 10, () => Promise.reject(new Error("no ps")))).toBe(false);
  });

  it("reads the real ps by default", async () => {
    expect(await descendsFrom(me, process.ppid)).toBe(true);
    expect(await descendsFrom(process.ppid, me)).toBe(false);
  });
});
