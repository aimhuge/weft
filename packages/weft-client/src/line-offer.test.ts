import { beforeAll, describe, expect, it, vi } from "vitest";
import sodiumModule from "libsodium-wrappers";
import { LINE_CHANNELS, lineOpener, linePlaintext, lineRow, lineTopic, LINE_PURPOSE, type LineRow } from "./line-offer";
import { spkiX25519, type SealCrypto, type SubtleLike } from "./seal";

const WORKER = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
const sealed = { v: 1 as const, epk: "e", iv: "i", ct: "c", tag: "t" };
const offer = { sdp: "v=0", key: "k", topic: "worker-line:ab", ice: [{ urls: "stun:s" }] };

let c: SealCrypto;
let pub: string;
beforeAll(async () => {
  await sodiumModule.ready;
  c = { sodium: sodiumModule, subtle: globalThis.crypto.subtle as unknown as SubtleLike };
  pub = spkiX25519(c.sodium, sodiumModule.crypto_box_keypair().publicKey);
});

describe("the line's wire names", () => {
  it("are the ones the worker reads", () => {
    expect(LINE_CHANNELS).toEqual({ host: "host", events: "events", control: "line", terminal: "terminal" });
    expect(LINE_PURPOSE).toBe("rtc-line");
    expect(lineTopic("ab")).toBe("worker-line:ab");
    expect(linePlaintext({ ice: [], topic: "t", key: "k", sdp: "s" })).toBe('{"sdp":"s","key":"k","topic":"t","ice":[]}');
  });
});

describe("lineRow", () => {
  it("addresses the worker's device with nothing but the sealed offer", () => {
    expect(lineRow("org", WORKER, sealed)).toEqual({ org_id: "org", kind: "line", target_device: `worker:${WORKER}`, folder: "", payload: { sealed } });
  });

  it("refuses anything that isn't a worker's id, so it can't be pointed at a Mac", () => {
    expect(() => lineRow("org", "mac-1", sealed)).toThrow("That isn't a worker.");
    expect(() => lineRow("org", `${WORKER}x`, sealed)).toThrow("That isn't a worker.");
  });
});

describe("lineOpener", () => {
  it("seals to the worker's published key and inserts the row", async () => {
    const insert = vi.fn<(row: LineRow) => Promise<{ id: string }>>(() => Promise.resolve({ id: "cmd-1" }));
    const publicKeyOf = vi.fn(() => Promise.resolve(pub));
    await expect(lineOpener({ crypto: c, orgId: "org", publicKeyOf, insert })(WORKER, offer)).resolves.toEqual({ commandId: "cmd-1" });
    expect(publicKeyOf).toHaveBeenCalledWith(WORKER);
    const row = insert.mock.calls[0]![0];
    expect(row.target_device).toBe(`worker:${WORKER}`);
    expect(JSON.stringify(row)).not.toContain("v=0");
  });

  it("stops at a worker with no key, and says why the database refused", async () => {
    const insert = vi.fn(() => Promise.resolve("new row violates row-level security policy"));
    await expect(lineOpener({ crypto: c, orgId: "org", publicKeyOf: () => Promise.resolve(null), insert })(WORKER, offer)).rejects.toThrow("hasn't published its key");
    expect(insert).not.toHaveBeenCalled();
    await expect(lineOpener({ crypto: c, orgId: "org", publicKeyOf: () => Promise.resolve(pub), insert })(WORKER, offer)).rejects.toThrow(
      "Couldn't reach your worker: new row violates row-level security policy",
    );
  });
});
