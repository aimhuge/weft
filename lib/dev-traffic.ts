// What the idle check reads off the machine, parsed (docs/architecture/dev-servers.md#idle-stop). Pure: lib/dev-idle-loop.ts
// runs the commands. `netstat -anv -p tcp` costs ~5 ms and names every TCP socket's process, so one call gives each
// server's listening ports and who is connected to them; `top -l 1 -stats pid,mem` (~0.4 s) gives each process's real
// footprint and only runs when the Services drawer asks.

export interface Socket {
  local: number;
  // NaN on a listener (`*.*`).
  foreign: number;
  state: string;
  pid: number;
}

// "127.0.0.1.1024", "*.8081", "::1.3000" → the port after the last dot.
const portOf = (addr: string) => Number(addr.slice(addr.lastIndexOf(".") + 1));

// tcp4 0 0 127.0.0.1.1024 127.0.0.1.59159 ESTABLISHED rx tx rhiwat shiwat node:97643 …
const ROW = /^tcp\S*\s+\d+\s+\d+\s+(\S+)\s+(\S+)\s+(\S+)\s+\d+\s+\d+\s+\d+\s+\d+\s+.*?:(\d+)(?:\s|$)/;

export function parseNetstat(out: string): Socket[] {
  const sockets: Socket[] = [];
  for (const line of out.split("\n")) {
    const m = ROW.exec(line);
    if (m) sockets.push({ local: portOf(m[1] as string), foreign: portOf(m[2] as string), state: m[3] as string, pid: Number(m[4]) });
  }
  return sockets;
}

// The ports each process listens on.
export function listeners(sockets: readonly Socket[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const s of sockets) {
    if (s.state !== "LISTEN") continue;
    const ports = out.get(s.pid) ?? [];
    if (!ports.includes(s.local)) out.set(s.pid, [...ports, s.local]);
  }
  return out;
}

// Whether something other than Weft's own server is connected to one of these processes' ports right now: the pane or a
// browser showing the app (its HMR socket stays open while the page is), a client mid-request. Each localhost
// connection shows twice, once per end; the client's end names who asked, so Weft's own status probes (every
// Services refresh, every review-panel poll from the server) don't count. A peer that can't be found is a real client.
export function hasVisitor(sockets: readonly Socket[], pids: ReadonlySet<number>, ignore: ReadonlySet<number>): boolean {
  const ports = new Set(sockets.filter((s) => s.state === "LISTEN" && pids.has(s.pid)).map((s) => s.local));
  return sockets.some((s) => {
    if (s.state !== "ESTABLISHED" || !pids.has(s.pid) || !ports.has(s.local)) return false;
    const peer = sockets.find((p) => p.local === s.foreign && p.foreign === s.local && p !== s);
    return !peer || !ignore.has(peer.pid);
  });
}

const UNIT: Record<string, number> = { B: 1 / 1024, K: 1, M: 1024, G: 1024 * 1024, T: 1024 * 1024 * 1024 };

// `top -l 1 -stats pid,mem -pid …` → KB by pid. top's MEM is the process's phys_footprint: resident plus compressed
// (and so swapped) memory, the number Activity Monitor shows, where ps's RSS leaves a swapped-out server looking small.
export function parseFootprints(out: string): Map<number, number> {
  const kb = new Map<number, number>();
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+([\d.]+)([BKMGT])[+-]?\s*$/.exec(line);
    if (m) kb.set(Number(m[1]), Math.round(Number(m[2]) * (UNIT[m[3] as string] as number)));
  }
  return kb;
}
