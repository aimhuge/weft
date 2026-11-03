// The worker's LAN port (lib/worker-lan.ts): what it takes (a whole offer, for this worker, signed by its pinned Mac,
// fresh, once) and how it holds up against a LAN (rate, size, method, path), over a real socket on 127.0.0.1.
import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OFFER_MAX_SKEW_MS } from "./lan-hint";
import { macKey, WORKER, workerKeys } from "./lan-hint.harness";
import { createLanServer, handleLanOffer, MAX_BODY, type LanServerDeps } from "./worker-lan";
import { nonceBook } from "./widen-nonces";
import { open, seal, type Sealed } from "./worker-seal";

const NOW = 1_800_000_000_000;
const w = workerKeys();
const mac = macKey();
const answer = { iv: "aXY=", ct: "Y3Q=" };

function deps(over: Partial<LanServerDeps> = {}): LanServerDeps {
  const kept: Record<string, number> = {};
  return {
    workerId: WORKER,
    macKeys: () => [mac.raw],
    nonces: nonceBook({ load: () => ({ ...kept }), save: (n) => Object.assign(kept, n) }, () => NOW),
    open: vi.fn((sealed: Sealed) => (open(w.box, sealed, "rtc-line") ? Promise.resolve(answer) : Promise.reject(new Error("no")))),
    now: () => NOW,
    log: vi.fn(),
    ...over,
  };
}

const sealed = () => seal(w.box.publicKey, JSON.stringify({ sdp: "v=0", key: "k", topic: "t", ice: [] }), "rtc-line");
const body = (over: Record<string, unknown> = {}, at = NOW) => {
  const s = sealed();
  return JSON.stringify({ v: 1, workerId: WORKER, sealed: s, mac: mac.stamp(WORKER, s, at), ...over });
};

describe("handleLanOffer", () => {
  it("opens a line for its pinned Mac's fresh offer and answers with the sealed answer", async () => {
    const d = deps();
    await expect(handleLanOffer(d, body())).resolves.toEqual({ status: 200, body: { answer } });
    expect(d.log).toHaveBeenCalledWith("Weft Worker: a board opened a line over the LAN");
  });

  it("takes each signed offer once: a replay is refused", async () => {
    const d = deps();
    const once = body();
    expect((await handleLanOffer(d, once)).status).toBe(200);
    expect(await handleLanOffer(d, once)).toEqual({ status: 403, body: { error: "refused" } });
    expect(d.open).toHaveBeenCalledTimes(1);
  });

  it("refuses what isn't a whole offer for this worker", async () => {
    const d = deps();
    expect((await handleLanOffer(d, "{")).status).toBe(400);
    expect((await handleLanOffer(d, JSON.stringify({ v: 1 }))).status).toBe(400);
    expect((await handleLanOffer(d, body({ workerId: "1a2b3c4d-0000-4000-8000-000000000000" }))).status).toBe(403);
    expect(d.open).not.toHaveBeenCalled();
  });

  it("refuses alike an unpinned Mac, a stale or future offer, and a signature over other bytes", async () => {
    const d = deps();
    const other = macKey();
    const s = sealed();
    const refused = [
      JSON.stringify({ v: 1, workerId: WORKER, sealed: s, mac: other.stamp(WORKER, s, NOW) }),
      body({}, NOW - OFFER_MAX_SKEW_MS - 1),
      body({}, NOW + OFFER_MAX_SKEW_MS + 1),
      JSON.stringify({ v: 1, workerId: WORKER, sealed: sealed(), mac: mac.stamp(WORKER, s, NOW) }),
      JSON.stringify({ v: 1, workerId: WORKER, sealed: s, mac: mac.stamp("1a2b3c4d-0000-4000-8000-000000000000", s, NOW) }),
    ];
    for (const r of refused) expect(await handleLanOffer(d, r)).toEqual({ status: 403, body: { error: "refused" } });
    expect(await handleLanOffer(deps({ macKeys: () => [] }), body())).toMatchObject({ status: 403 });
    expect(d.open).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith("Weft Worker: refused a LAN offer that isn't from this box's Mac");
  });

  it("answers 503 when the line doesn't open, or doesn't answer in time", async () => {
    expect(await handleLanOffer(deps({ open: () => Promise.reject(new Error("bad seal")) }), body())).toEqual({ status: 503, body: { error: "no line" } });
    vi.useFakeTimers();
    try {
      const slow = handleLanOffer(deps({ open: () => new Promise(() => {}), answerMs: 50 }), body());
      await vi.advanceTimersByTimeAsync(60);
      await expect(slow).resolves.toMatchObject({ status: 503 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("defaults its clock and log", async () => {
    const d = deps({ now: undefined, log: undefined, nonces: nonceBook({ load: () => ({}), save: () => {} }) });
    expect((await handleLanOffer(d, body({}, Date.now()))).status).toBe(200);
    expect((await handleLanOffer(d, "{")).status).toBe(400);
  });
});

type Reply = { status: number; body: string };
function post(port: number, text: string, o: { path?: string; method?: string; length?: number; chunked?: boolean } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: o.path ?? "/line", method: o.method ?? "POST", headers: { "content-type": "application/json", ...(o.length !== undefined ? { "content-length": o.length } : {}) } }, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => (data += c.toString()));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    if (o.chunked) {
      req.write(text);
      req.end();
    } else req.end(text);
  });
}

describe("the port", () => {
  let close: () => Promise<void> = () => Promise.resolve();
  afterEach(() => close());

  async function serve(over: Partial<LanServerDeps> = {}) {
    const server = createLanServer(deps(over));
    close = server.close;
    return server.listen(0, "127.0.0.1");
  }

  it("answers a posted offer on /line, and only there, only by POST", async () => {
    const port = await serve();
    const ok = await post(port, body());
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ answer });
    expect((await post(port, body(), { path: "/other" })).status).toBe(404);
    expect((await post(port, "", { method: "GET" })).status).toBe(405);
  });

  it("refuses a body over MAX_BODY, by its length or as it streams", async () => {
    const port = await serve();
    expect((await post(port, "x", { length: MAX_BODY + 1 })).status).toBe(413);
    // Chunked, with no length to refuse up front: cut off as it streams past the cap.
    await post(port, "x".repeat(MAX_BODY + 10), { chunked: true }).then(
      (r) => expect(r.status).toBe(413),
      (err: unknown) => expect((err as Error).message).toMatch(/ECONNRESET|socket hang up|EPIPE/),
    );
  });

  it("drops a sender that goes away mid-body, and still answers the next", async () => {
    const opened = vi.fn(() => Promise.resolve(answer));
    const port = await serve({ open: opened });
    await new Promise<void>((done) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/line", method: "POST", headers: { "transfer-encoding": "chunked" } });
      req.on("error", () => done());
      req.write("{\"v\":");
      setTimeout(() => {
        req.destroy();
        done();
      }, 50);
    });
    expect((await post(port, body())).status).toBe(200);
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("slows down a sender past the rate", async () => {
    const port = await serve({ limit: { perAddress: 1, total: 10, windowMs: 60_000, maxAddresses: 4 } });
    expect((await post(port, "{")).status).toBe(400);
    expect((await post(port, body())).status).toBe(429);
  });

  it("holds at most MAX_OPENING offers being answered at once", async () => {
    const release: (() => void)[] = [];
    const port = await serve({ open: () => new Promise((done) => release.push(() => done(answer))) });
    const first = [post(port, body()), post(port, body())];
    await vi.waitFor(() => expect(release).toHaveLength(2));
    expect((await post(port, body())).status).toBe(429);
    release.forEach((fn) => fn());
    expect((await Promise.all(first)).map((r) => r.status)).toEqual([200, 200]);
  });

  it("rejects listening on a port that's taken", async () => {
    const port = await serve();
    const second = createLanServer(deps());
    await expect(second.listen(port, "127.0.0.1")).rejects.toThrow(/EADDRINUSE/);
  });
});
