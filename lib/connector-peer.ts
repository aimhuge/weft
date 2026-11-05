// Who is on the other end of the worker's connector socket (lib/connector-socket.ts;
// docs/architecture/connectors.md#on-the-worker). Node has no getsockopt, so the peer's pid is read the way the OS
// tools see it: on macOS, lsof shows each Unix socket's kernel address and its peer's (`->0x…`), so the process whose
// socket points at ours is the peer (LOCAL_PEERPID's answer); on Linux, ss shows each socket's inode, its peer's and
// the owning process (SO_PEERCRED's answer). Then the peer must descend from the CLI the capability was handed to
// (lib/connector-env.ts), by its parent chain in `ps`. Anything that can't be read refuses: no peer, no token.
import { execFile } from "node:child_process";
import fs from "node:fs";
import type net from "node:net";
import { parseTree } from "./process-tree";

export type Run = (cmd: string, args: string[]) => Promise<string>;

export const runTool: Run = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf8", timeout: 5_000, maxBuffer: 16 * 1024 * 1024 }, (err, out) => (err ? reject(new Error(err.message)) : resolve(out)));
  });

// The accepted socket's file descriptor in this process (libuv's handle; there's no public API for it).
export const fdOf = (conn: net.Socket): number | null => {
  const fd = (conn as unknown as { _handle?: { fd?: unknown } })._handle?.fd;
  return typeof fd === "number" && fd >= 0 ? fd : null;
};

// lsof -F output: records of p<pid>, then per file f<fd>, d<device>, n<name>.
interface LsofFile {
  pid: number;
  fd: string;
  device: string;
  name: string;
}

export function parseLsof(out: string): LsofFile[] {
  const files: LsofFile[] = [];
  let pid = 0;
  let cur: LsofFile | null = null;
  for (const line of out.split("\n")) {
    const tag = line[0];
    const val = line.slice(1);
    if (tag === "p") pid = Number(val);
    else if (tag === "f") files.push((cur = { pid, fd: val, device: "", name: "" }));
    else if (cur && tag === "d") cur.device = val;
    else if (cur && tag === "n") cur.name = val;
  }
  return files;
}

// macOS: our accepted socket's kernel address, then the process holding a socket whose peer is that address.
export async function darwinPeer(fd: number, run: Run = runTool): Promise<number | null> {
  const mine = parseLsof(await run("lsof", ["-nP", "-a", "-p", String(process.pid), "-d", String(fd), "-U", "-F", "fdn"]))[0];
  if (!mine?.device) return null;
  const peer = parseLsof(await run("lsof", ["-nP", "-U", "-F", "pfdn"])).find((f) => f.name === `->${mine.device}` && f.pid !== process.pid);
  return peer?.pid ?? null;
}

// ss -xpn lines: "u_str ESTAB 0 0 <local addr> <inode> <peer addr> <peer inode> users:(("name",pid=N,fd=M))".
export function parseSs(out: string): { inode: string; peer: string; pid: number }[] {
  const rows: { inode: string; peer: string; pid: number }[] = [];
  for (const line of out.split("\n")) {
    const [, inode, peer, pid] = /\s(\d+)\s+\S+\s+(\d+)\s+users:\(\("[^"]*",pid=(\d+)/.exec(line) ?? [];
    if (inode && peer && pid) rows.push({ inode, peer, pid: Number(pid) });
  }
  return rows;
}

// Linux: our accepted socket's inode (from /proc/self/fd), then the socket whose peer it is, and its process.
export async function linuxPeer(fd: number, run: Run = runTool, readlink: (p: string) => string = fs.readlinkSync): Promise<number | null> {
  const inode = /^socket:\[(\d+)\]$/.exec(readlink(`/proc/self/fd/${fd}`))?.[1];
  if (!inode) return null;
  const peer = parseSs(await run("ss", ["-xpnH"])).find((r) => r.peer === inode && r.pid !== process.pid);
  return peer?.pid ?? null;
}

export async function peerPid(conn: net.Socket, o: { platform?: NodeJS.Platform; run?: Run } = {}): Promise<number | null> {
  const fd = fdOf(conn);
  if (fd === null) return null;
  const platform = o.platform ?? process.platform;
  try {
    if (platform === "darwin") return await darwinPeer(fd, o.run);
    if (platform === "linux") return await linuxPeer(fd, o.run);
  } catch {
    // A tool that's missing or failed: no peer.
  }
  return null;
}

// Whether `pid` is `ancestor` or runs under it, by the parent chain `ps` shows now.
export async function descendsFrom(pid: number, ancestor: number, run: Run = runTool): Promise<boolean> {
  if (pid === ancestor) return true;
  let procs;
  try {
    procs = parseTree(await run("/bin/ps", ["-axo", "pid=,ppid=,pgid="]));
  } catch {
    return false;
  }
  const parent = new Map(procs.map((p) => [p.pid, p.ppid]));
  const seen = new Set<number>();
  for (let at = parent.get(pid); at !== undefined && at > 1 && !seen.has(at); at = parent.get(at)) {
    if (at === ancestor) return true;
    seen.add(at);
  }
  return false;
}
