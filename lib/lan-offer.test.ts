// Offering a line over the LAN from this Mac's server (lib/lan-offer.ts): each step that can fail leaves it to the
// Supabase row, and the real wiring asks main, browses once per process and posts with a timeout.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hintFingerprint, lanOfferMessage, offerDigest, signHint } from "./lan-hint";
import { macKey, WORKER, workerKeys } from "./lan-hint.harness";
import type { Candidate, LanBrowser } from "./lan-mdns";
import { macSigned } from "./worker-mac-keys";
import { open } from "./worker-seal";

const mdnsMade = vi.hoisted(() => ({ count: 0 }));
vi.mock("./browser-shell", () => ({ shell: vi.fn(() => Promise.reject(new Error("The browser pane only exists in the desktop app"))) }));
vi.mock("multicast-dns", () => ({
  default: () => {
    mdnsMade.count += 1;
    return { on: vi.fn(), query: vi.fn(), respond: vi.fn(), destroy: vi.fn() };
  },
}));

const { answerOf, closeLanBrowser, lanAnswer, offerOverLan, realLanDeps } = await import("./lan-offer");
type Deps = Parameters<typeof offerOverLan>[2];

const NOW = 1_800_000_000_000;
const w = workerKeys();
const mac = macKey();
const offer = { sdp: "v=0", key: "k", topic: "worker-line:t", ice: [{ urls: "stun:s" }] };
const answer = { iv: "aXY=", ct: "Y3Q=" };
const hint = (port = 4242) => signHint({ id: WORKER, fp: hintFingerprint(w.box.publicKey), port, at: NOW }, w.signer);

function browser(address = "192.168.1.20"): LanBrowser {
  return {
    candidate: vi.fn((_id: string, check: (c: Candidate) => boolean) => {
      const c = { hint: hint(), address, heard: NOW };
      return Promise.resolve(check(c) ? c : null);
    }),
    close: vi.fn(),
  };
}

function deps(over: Partial<Deps> = {}): Deps & { posted: { url: string; body: unknown }[] } {
  const posted: { url: string; body: unknown }[] = [];
  return {
    posted,
    keys: vi.fn(() => Promise.resolve({ signKey: w.sign.publicKey, boxKey: w.box.publicKey })),
    sign: vi.fn((workerId: string, digest: string) => Promise.resolve({ key: mac.raw, sig: mac.sign(lanOfferMessage(workerId, NOW, "ab".repeat(16), digest)), issuedAt: NOW, nonce: "ab".repeat(16) })),
    browser: () => browser(),
    post: vi.fn((url: string, body: unknown) => (posted.push({ url, body }), Promise.resolve({ answer }))),
    now: () => NOW,
    log: vi.fn(),
    ...over,
  };
}

describe("offerOverLan", () => {
  it("seals to the pinned box key, has main sign it, posts it to the hinted address and hands back the answer", async () => {
    const d = deps();
    await expect(offerOverLan(WORKER, offer, d)).resolves.toEqual(answer);
    const { url, body } = d.posted[0]!;
    expect(url).toBe("http://192.168.1.20:4242/line");
    const sent = body as { v: number; workerId: string; sealed: never; mac: { key: string; sig: string; issuedAt: number; nonce: string } };
    expect(sent).toMatchObject({ v: 1, workerId: WORKER });
    expect(JSON.parse(open(w.box, sent.sealed, "rtc-line"))).toEqual(offer);
    expect(macSigned(sent.mac.key, lanOfferMessage(WORKER, sent.mac.issuedAt, sent.mac.nonce, offerDigest(sent.sealed)), sent.mac.sig)).toBe(true);
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("over the LAN (192.168.1.20)"));
  });

  it("brackets an IPv6 address", async () => {
    const d = deps({ browser: () => browser("fe80::1") });
    await offerOverLan(WORKER, offer, d);
    expect(d.posted[0]!.url).toBe("http://[fe80::1]:4242/line");
  });

  it("is null, for the row, when any step fails", async () => {
    const noBrowse = vi.fn(() => browser());
    // Off the desktop main isn't there: no socket is opened.
    expect(await offerOverLan(WORKER, offer, deps({ keys: () => Promise.reject(new Error("no shell")), browser: noBrowse }))).toBeNull();
    expect(await offerOverLan(WORKER, offer, deps({ keys: () => Promise.resolve(null), browser: noBrowse }))).toBeNull();
    expect(noBrowse).not.toHaveBeenCalled();
    expect(await offerOverLan(WORKER, offer, deps({ browser: () => null }))).toBeNull();
    // A hint that doesn't check against the pins.
    expect(await offerOverLan(WORKER, offer, deps({ keys: () => Promise.resolve({ signKey: workerKeys().sign.publicKey, boxKey: w.box.publicKey }) }))).toBeNull();
    expect(await offerOverLan(WORKER, offer, deps({ post: () => Promise.reject(new Error("the worker said 403")) }))).toBeNull();
    expect(await offerOverLan(WORKER, offer, deps({ post: () => Promise.resolve({ answer: { iv: 1 } }), log: undefined }))).toBeNull();
    expect(await offerOverLan(WORKER, offer, deps({ now: undefined }))).toBeNull();
  });
});

describe("answerOf", () => {
  it("reads a sealed answer, and nothing else", () => {
    expect(answerOf({ answer })).toEqual(answer);
    for (const bad of [null, "x", {}, { answer: "x" }, { answer: { iv: "!", ct: "Y3Q=" } }, { answer: { iv: "A".repeat(33), ct: "Y3Q=" } }, { answer: { iv: "aXY=", ct: "A".repeat(16 * 1024 + 1) } }]) {
      expect(answerOf(bad)).toBeNull();
    }
  });
});

describe("realLanDeps", () => {
  beforeEach(() => closeLanBrowser());
  afterEach(() => closeLanBrowser());

  it("asks main for the pins and the signature", async () => {
    const shell = vi.fn((route: string): Promise<Record<string, unknown>> => Promise.resolve(route === "/lan-line/keys" ? { signKey: "s", boxKey: "b" } : { key: "k", sig: "g", issuedAt: 1, nonce: "n" }));
    const d = realLanDeps(shell, vi.fn());
    await expect(d.keys(WORKER)).resolves.toEqual({ signKey: "s", boxKey: "b" });
    await expect(d.sign(WORKER, "dd")).resolves.toEqual({ key: "k", sig: "g", issuedAt: 1, nonce: "n" });
    expect(shell).toHaveBeenCalledWith("/lan-line/sign", { workerId: WORKER, digest: "dd" });
    shell.mockResolvedValueOnce({});
    await expect(d.keys(WORKER)).resolves.toBeNull();
    vi.spyOn(console, "log").mockImplementation(() => {});
    d.log?.("hi");
  });

  it("browses once per process, and not at all with WEFT_LAN=0", () => {
    const make = vi.fn(() => ({ on: vi.fn(), query: vi.fn(), respond: vi.fn(), destroy: vi.fn() }));
    const d = realLanDeps(vi.fn(), make, {});
    expect(d.browser()).toBe(d.browser());
    expect(make).toHaveBeenCalledTimes(1);
    expect(realLanDeps(vi.fn(), make, { WEFT_LAN: "0" }).browser()).toBeNull();
  });

  it("posts JSON with a timeout and no redirects, and reads the reply", async () => {
    const fetchFn = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response(JSON.stringify({ answer }), { status: 200 })));
    const d = realLanDeps(vi.fn(), vi.fn(), {}, fetchFn as unknown as typeof fetch);
    await expect(d.post("http://h:1/line", { a: 1 }, 1_000)).resolves.toEqual({ answer });
    expect(fetchFn.mock.calls[0]![1]).toMatchObject({ method: "POST", body: '{"a":1}', redirect: "error" });
    fetchFn.mockResolvedValueOnce(new Response("{}", { status: 403 }));
    await expect(d.post("http://h:1/line", {}, 1_000)).rejects.toThrow("the worker said 403");
    fetchFn.mockResolvedValueOnce(new Response("x".repeat(40_000), { status: 200 }));
    await expect(d.post("http://h:1/line", {}, 1_000)).rejects.toThrow("too big");
  });
});

describe("lanAnswer", () => {
  it("off the desktop, answers null without opening a socket", async () => {
    await expect(lanAnswer(WORKER, offer)).resolves.toBeNull();
    await expect(lanAnswer(WORKER, offer)).resolves.toBeNull();
    expect(mdnsMade.count).toBe(0);
  });

  it("on the desktop, browses with multicast-dns, and with no hint heard, answers null", async () => {
    const { shell } = await import("./browser-shell");
    vi.mocked(shell).mockResolvedValueOnce({ signKey: w.sign.publicKey, boxKey: w.box.publicKey });
    await expect(lanAnswer(WORKER, offer)).resolves.toBeNull();
    expect(mdnsMade.count).toBe(1);
    closeLanBrowser();
  });
});
