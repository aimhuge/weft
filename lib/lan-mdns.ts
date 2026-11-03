// The mDNS side of the LAN path (docs/architecture/weft-worker.md#the-lan-path), over multicast-dns (MIT): a worker
// advertises `_weft._tcp` with its signed hint in the TXT record (lib/lan-hint.ts), and this Mac's server browses for it.
// Both take the socket as MdnsLike, so tests drive them with a fake and nothing touches the network.
//
// What's heard is a candidate, nothing more: the browser keeps the last few TXT records per worker id as they came, and
// checks them only when a line is about to be offered (hintFor), against the keys this Mac pinned. The address is the
// packet's own source, which anyone on the LAN can claim; a wrong one costs the attempt, never the offer (it's sealed).
import { LAN_SERVICE, readHintTxt, type SignedHint } from "./lan-hint";

type MdnsRecord = { name: string; type: string; ttl?: number; data?: unknown; class?: string; flush?: boolean };
type Packet = { questions?: { name: string; type: string }[]; answers?: MdnsRecord[]; additionals?: MdnsRecord[] };
type Rinfo = { address: string; port: number };

export interface MdnsLike {
  on(event: "query" | "response", fn: (packet: Packet, rinfo: Rinfo) => void): unknown;
  on(event: "error" | "warning", fn: (err: Error) => void): unknown;
  respond(packet: { answers: MdnsRecord[] }): void;
  query(packet: { questions: { name: string; type: string }[] }): void;
  destroy(): void;
}

export const ANNOUNCE_TTL = 120;
// At most one answer a second, however many queries come.
export const RESPOND_GAP_MS = 1_000;

export interface Advert {
  // The service instance, e.g. weft-1a2b3c4d5e6f, and the host name its SRV points at, e.g. weft-1a2b3c4d5e6f.local.
  instance: string;
  host: string;
  port: number;
  // The TXT strings, signed afresh by the caller as they age (lib/worker-lan-start.ts).
  txt: () => string[];
  addresses: () => string[];
  refreshMs: number;
  now?: () => number;
  log?: (msg: string) => void;
}

export function advertise(mdns: MdnsLike, a: Advert): () => void {
  const now = a.now ?? Date.now;
  const name = `${a.instance}.${LAN_SERVICE}`;
  const records = (ttl: number): MdnsRecord[] => [
    { name: LAN_SERVICE, type: "PTR", ttl, data: name },
    { name, type: "SRV", ttl, data: { port: a.port, target: a.host, priority: 0, weight: 0 } },
    { name, type: "TXT", ttl, data: a.txt() },
    ...a.addresses().map((ip): MdnsRecord => ({ name: a.host, type: "A", ttl, data: ip })),
  ];
  let last = -Infinity;
  const announce = () => {
    last = now();
    mdns.respond({ answers: records(ANNOUNCE_TTL) });
  };
  // A socket error (5353 taken, an interface gone) must not take the daemon down: the hint just stops.
  mdns.on("error", (err) => a.log?.(`Weft Worker: mDNS: ${err.message}`));
  mdns.on("warning", () => {});
  const ours = new Set([LAN_SERVICE, name.toLowerCase(), a.host.toLowerCase()]);
  mdns.on("query", (packet) => {
    if (!packet.questions?.some((q) => ours.has(q.name.toLowerCase()))) return;
    if (now() - last < RESPOND_GAP_MS) return;
    announce();
  });
  announce();
  const timer = setInterval(announce, a.refreshMs);
  return () => {
    clearInterval(timer);
    // A goodbye (TTL 0), so browsers drop it rather than wait out the TTL.
    mdns.respond({ answers: records(0) });
  };
}

export const MAX_WORKERS = 64;
export const PER_WORKER = 4;
export const HEARD_MS = 5 * 60_000;
export const QUERY_MS = 30_000;

export type Candidate = { hint: SignedHint; address: string; heard: number };

export function createLanBrowser(mdns: MdnsLike, o: { now?: () => number; queryMs?: number } = {}) {
  const now = o.now ?? Date.now;
  const heard = new Map<string, Candidate[]>();
  const waiters = new Set<() => void>();

  function keep(hint: SignedHint, address: string) {
    const list = (heard.get(hint.id) ?? []).filter((c) => !(c.address === address && c.hint.sig === hint.sig) && now() - c.heard < HEARD_MS);
    if (!heard.has(hint.id) && heard.size >= MAX_WORKERS) heard.delete(heard.keys().next().value as string);
    heard.set(hint.id, [{ hint, address, heard: now() }, ...list].slice(0, PER_WORKER));
  }

  // Without a socket there are no hints, and every line takes the relay.
  mdns.on("error", () => {});
  mdns.on("warning", () => {});
  mdns.on("response", (packet, rinfo) => {
    for (const r of [...(packet.answers ?? []), ...(packet.additionals ?? [])]) {
      if (r.type !== "TXT" || !r.name.toLowerCase().endsWith(`.${LAN_SERVICE}`)) continue;
      const hint = readHintTxt(r.data);
      if (hint) keep(hint, rinfo.address);
    }
    waiters.forEach((fn) => fn());
  });

  const query = () => mdns.query({ questions: [{ name: LAN_SERVICE, type: "PTR" }] });
  query();
  const timer = setInterval(query, o.queryMs ?? QUERY_MS);

  // The newest candidate for a worker that passes `check`, waiting up to waitMs (after a fresh query) for one.
  function candidate(workerId: string, check: (c: Candidate) => boolean, waitMs: number): Promise<Candidate | null> {
    const pick = () =>
      (heard.get(workerId.toLowerCase()) ?? [])
        .filter((c) => now() - c.heard < HEARD_MS && check(c))
        .sort((a, b) => b.hint.at - a.hint.at)[0] ?? null;
    const found = pick();
    if (found || waitMs <= 0) return Promise.resolve(found);
    return new Promise((resolve) => {
      const done = (c: Candidate | null) => {
        clearTimeout(timer);
        waiters.delete(look);
        resolve(c);
      };
      const look = () => {
        const c = pick();
        if (c) done(c);
      };
      const timer = setTimeout(() => done(null), waitMs);
      waiters.add(look);
      query();
    });
  }

  return {
    candidate,
    close() {
      clearInterval(timer);
      waiters.clear();
      mdns.destroy();
    },
  };
}

export type LanBrowser = ReturnType<typeof createLanBrowser>;
