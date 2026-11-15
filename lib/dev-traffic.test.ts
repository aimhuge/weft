import { describe, expect, it } from "vitest";
import { hasVisitor, listeners, parseFootprints, parseNetstat } from "./dev-traffic";

const row = (local: string, foreign: string, state: string, proc: string) =>
  `tcp4       0      0  ${local}  ${foreign}  ${state}         7072     74341581  405248 4194304             ${proc}    00102 00000104 0000000009995b86 00000081 01000800      2      0 000000`;

const NETSTAT = [
  "Active Internet connections (including servers)",
  "Proto Recv-Q Send-Q  Local Address  Foreign Address  (state)  rxbytes txbytes rhiwat shiwat process:pid state options gencnt flags flags1 usecnt rtncnt fltrs",
  row("*.4002", "*.*", "LISTEN", "node:500"),
  row("*.4002", "*.*", "LISTEN", "node:500"),
  row("::1.4003", "*.*", "LISTEN", "Weft Helper:501"),
  row("127.0.0.1.4002", "127.0.0.1.60001", "ESTABLISHED", "node:500"),
  row("127.0.0.1.60001", "127.0.0.1.4002", "ESTABLISHED", "next-server (v16.4.5):900"),
  "udp4 garbage",
].join("\n");

describe("parseNetstat", () => {
  it("reads ports, state and pid, a process name with spaces too", () => {
    const sockets = parseNetstat(NETSTAT);
    expect(sockets).toHaveLength(5);
    expect(sockets[0]).toEqual({ local: 4002, foreign: Number.NaN, state: "LISTEN", pid: 500 });
    expect(sockets[2]).toMatchObject({ local: 4003, pid: 501 });
    expect(sockets[4]).toEqual({ local: 60001, foreign: 4002, state: "ESTABLISHED", pid: 900 });
  });
});

describe("listeners", () => {
  it("gives each process its listening ports once", () => {
    expect(listeners(parseNetstat(NETSTAT))).toEqual(new Map([[500, [4002]], [501, [4003]]]));
  });
});

describe("hasVisitor", () => {
  const sockets = parseNetstat(NETSTAT);
  it("doesn't count a connection from Weft's own server", () => {
    expect(hasVisitor(sockets, new Set([500]), new Set([900]))).toBe(false);
  });
  it("counts any other client", () => {
    expect(hasVisitor(sockets, new Set([500]), new Set())).toBe(true);
  });
  it("counts a client whose end can't be found", () => {
    const remote = parseNetstat([row("*.4002", "*.*", "LISTEN", "node:500"), row("10.0.0.2.4002", "10.0.0.9.5555", "ESTABLISHED", "node:500")].join("\n"));
    expect(hasVisitor(remote, new Set([500]), new Set([900]))).toBe(true);
  });
  it("ignores other processes' and outbound sockets", () => {
    expect(hasVisitor(sockets, new Set([77]), new Set())).toBe(false);
    const outbound = parseNetstat([row("*.4002", "*.*", "LISTEN", "node:500"), row("127.0.0.1.61000", "1.2.3.4.443", "ESTABLISHED", "node:500")].join("\n"));
    expect(hasVisitor(outbound, new Set([500]), new Set())).toBe(false);
  });
});

describe("parseFootprints", () => {
  it("reads top's MEM in its units", () => {
    const out = ["PID    MEM", "97643  5428M", "97493  33M  ", "12  512K+", "13  2G-", "14  1.5T", "15  2048B", "junk"].join("\n");
    expect(parseFootprints(out)).toEqual(
      new Map([
        [97643, 5428 * 1024],
        [97493, 33 * 1024],
        [12, 512],
        [13, 2 * 1024 * 1024],
        [14, 1.5 * 1024 * 1024 * 1024],
        [15, 2],
      ]),
    );
  });
});
