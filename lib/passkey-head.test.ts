import { describe, expect, it } from "vitest";
import { macSigner } from "./mac-signer.harness";
import { behind, headMessage, HEADS_FLOODED, HEADS_MAX, HEADS_UNREAD, latestHead, newestHead, readHead, type PasskeyHead } from "./passkey-head";

const signed = (mac: ReturnType<typeof macSigner>, h: PasskeyHead) => ({ ...h, mac: "mac-1", sig: mac.sign(headMessage(h)) });

describe("headMessage", () => {
  it("is canonical JSON over the version, worker, generation and time", () => {
    expect(headMessage({ worker: "w1", generation: 7, issuedAt: 9 })).toBe('{"generation":7,"issuedAt":9,"v":"weft-endorse-head-v1","worker":"w1"}');
  });
});

describe("readHead", () => {
  it("takes a whole head and nothing less", () => {
    expect(readHead({ worker: "w", generation: 1, issuedAt: 2, sig: "s" })).toEqual({ worker: "w", generation: 1, issuedAt: 2, sig: "s" });
    expect(readHead(null)).toBeNull();
    expect(readHead("x")).toBeNull();
    expect(readHead({ worker: 1, generation: 1, issuedAt: 2, sig: "s" })).toBeNull();
    expect(readHead({ worker: "w", generation: "1", issuedAt: 2, sig: "s" })).toBeNull();
    expect(readHead({ worker: "w", generation: 1, issuedAt: Infinity, sig: "s" })).toBeNull();
    expect(readHead({ worker: "w", generation: 1, issuedAt: 2 })).toBeNull();
  });
});

describe("newestHead", () => {
  it("is the highest generation a trusted key signed for this worker, skipping junk, other workers and other keys", () => {
    const mac = macSigner();
    const other = macSigner();
    const rows = [
      signed(mac, { worker: "w1", generation: 5, issuedAt: 1 }),
      signed(mac, { worker: "w1", generation: 3, issuedAt: 1 }),
      // An old head inserted again changes nothing; a newer one by another key or for another worker counts for nothing.
      signed(mac, { worker: "w1", generation: 3, issuedAt: 1 }),
      signed(other, { worker: "w1", generation: 99, issuedAt: 1 }),
      signed(mac, { worker: "w2", generation: 50, issuedAt: 1 }),
      { worker: "w1", generation: 1000, issuedAt: 1, sig: "junk" },
      "junk",
    ];
    expect(newestHead(rows, "w1", [mac.key])).toBe(5);
    expect(newestHead(rows, "w1", [])).toBe(0);
    expect(newestHead([], "w1", [mac.key])).toBe(0);
  });
});

describe("latestHead", () => {
  it("reads the log, and refuses when it can't, or when it holds more than one read can check", async () => {
    const mac = macSigner();
    const row = signed(mac, { worker: "w1", generation: 4, issuedAt: 1 });
    expect(await latestHead({ worker: "w1", heads: () => Promise.resolve([row]) }, [mac.key])).toEqual({ latest: 4 });
    expect(await latestHead({ worker: "w1", heads: () => Promise.reject(new Error("down")) }, [mac.key])).toEqual({ refused: HEADS_UNREAD });
    expect(await latestHead({ worker: "w1", heads: () => Promise.resolve({} as unknown as unknown[]) }, [mac.key])).toEqual({ refused: HEADS_UNREAD });
    const flood = Array.from({ length: HEADS_MAX + 1 }, () => "junk");
    expect(await latestHead({ worker: "w1", heads: () => Promise.resolve(flood) }, [mac.key])).toEqual({ refused: HEADS_FLOODED });
  });

  it("says how far behind in words", () => {
    expect(behind(1, 2)).toMatch(/holds set 1, your Mac signed 2/);
  });
});
