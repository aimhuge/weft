// The cross-test: an offer @weft/client seals in a browser or on the phone (packages/weft-client/src/seal.ts) opens on
// the worker exactly as one this Mac's server seals (lib/worker-seal.ts), and an answer the worker seals
// (lib/rtc-signal.ts) opens under the client's own answer keys.
import { beforeAll, describe, expect, it } from "vitest";
import sodiumModule from "libsodium-wrappers";
import { answerKeys, linePlaintext, LINE_PURPOSE, sealTo, type SealCrypto, type SubtleLike } from "@weft/client";
import { RTC_PURPOSE, openAnswer, sealAnswer } from "./rtc-signal";
import { newSealKeys, open, seal, type SealKeys } from "./worker-seal";

let c: SealCrypto;
let keys: SealKeys;
beforeAll(async () => {
  await sodiumModule.ready;
  c = { sodium: sodiumModule, subtle: globalThis.crypto.subtle as unknown as SubtleLike };
  keys = newSealKeys();
});

const offer = { sdp: "v=0\r\na=fingerprint:sha-256 AB:CD\r\n", key: "k".repeat(44), topic: "worker-line:00ff", ice: [{ urls: "stun:stun.cloudflare.com:3478" }] };

describe("a line offer, sealed by node or by @weft/client", () => {
  it("opens the same on the worker", async () => {
    const plain = linePlaintext(offer);
    // The server's own plaintext (lib/worker-board.ts openWorkerLine) is byte for byte the client's.
    expect(plain).toBe(JSON.stringify({ sdp: offer.sdp, key: offer.key, topic: offer.topic, ice: offer.ice }));
    const byNode = seal(keys.publicKey, plain, LINE_PURPOSE);
    const byClient = await sealTo(c, keys.publicKey, plain, LINE_PURPOSE);
    expect(Object.keys(byClient).sort()).toEqual(Object.keys(byNode).sort());
    expect(open(keys, byNode, LINE_PURPOSE)).toBe(plain);
    expect(open(keys, byClient, LINE_PURPOSE)).toBe(plain);
  });

  it("carries text beyond ASCII intact", async () => {
    const text = "naïve ☃ 🧵";
    expect(open(keys, await sealTo(c, keys.publicKey, text, LINE_PURPOSE), LINE_PURPOSE)).toBe(text);
  });

  it("won't open as another purpose, for another worker, or once changed", async () => {
    const sealed = await sealTo(c, keys.publicKey, "x", LINE_PURPOSE);
    expect(() => open(keys, sealed, RTC_PURPOSE)).toThrow();
    expect(() => open(newSealKeys(), sealed, LINE_PURPOSE)).toThrow();
    const ct = Buffer.from(sealed.ct, "base64");
    ct[0] = (ct[0] ?? 0) ^ 1;
    expect(() => open(keys, { ...sealed, ct: ct.toString("base64") }, LINE_PURPOSE)).toThrow();
    // Swapping in another ephemeral key changes the HKDF salt as well as the shared secret.
    const other = await sealTo(c, keys.publicKey, "x", LINE_PURPOSE);
    expect(() => open(keys, { ...sealed, epk: other.epk }, LINE_PURPOSE)).toThrow();
  });
});

describe("the answer under the one-time key", () => {
  it("opens with either side's code", async () => {
    const client = answerKeys(c);
    const key = client.newKey();
    await expect(client.open(key, await sealAnswer(key, "v=0 answer"))).resolves.toBe("v=0 answer");
    await expect(openAnswer(key, await sealAnswer(key, "again"))).resolves.toBe("again");
  });
});
