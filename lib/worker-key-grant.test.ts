import { describe, expect, it } from "vitest";
import { macSigner } from "./mac-signer.harness";
import { acceptGrant, grantMessage, grantPurpose, readGrantRow } from "./worker-key-grant";
import { grantKit, newSyncKey, ORG, WORKER } from "./worker-key-grant.harness";
import { newSealKeys, seal } from "./worker-seal";

describe("acceptGrant", () => {
  it("takes a grant its pinned Mac signed, sealed to its own box key, and opens the key", () => {
    const kit = grantKit();
    const key = newSyncKey();
    expect(acceptGrant(kit.make(3, key), kit.ctx())).toEqual({ key: { version: 3, key } });
  });

  it("refuses what isn't a grant row", () => {
    const kit = grantKit();
    for (const raw of [null, "x", { ...kit.make(1), version: 0 }, { ...kit.make(1), version: 1.5 }, { ...kit.make(1), sig: "" }]) {
      expect(acceptGrant(raw, kit.ctx())).toEqual({ refused: "it isn't a key grant" });
    }
    expect(readGrantRow(kit.make(2))?.version).toBe(2);
  });

  it("refuses one for another worker or workspace", () => {
    const kit = grantKit();
    expect(acceptGrant(kit.make(1), { ...kit.ctx(), orgId: "other" })).toEqual({ refused: "it's for another worker or workspace" });
    expect(acceptGrant(kit.make(1), { ...kit.ctx(), workerId: "other" })).toEqual({ refused: "it's for another worker or workspace" });
  });

  it("refuses one sealed to another box key, even signed by its Mac", () => {
    const kit = grantKit();
    const mine = newSealKeys();
    expect(acceptGrant(kit.make(1), { ...kit.ctx(), keys: mine })).toEqual({ refused: "it was sealed to another box key (re-pinned or reset?)" });
  });

  it("takes nothing on a box that trusts no Mac (enrolled by token, or its Mac revoked)", () => {
    const kit = grantKit();
    const got = acceptGrant(kit.make(1), kit.ctx([]));
    expect("refused" in got && got.refused).toMatch(/trusts no Mac/);
  });

  it("refuses a grant a server planted: signed by a key the box never pinned, or the sealed box swapped", () => {
    const kit = grantKit();
    const planted = grantKit(kit.keys, macSigner());
    expect(acceptGrant(planted.make(1), kit.ctx())).toEqual({ refused: "no Mac this box trusts signed it" });
    const real = kit.make(1);
    const swapped = { ...real, sealed: planted.make(1).sealed };
    expect(acceptGrant(swapped, kit.ctx())).toEqual({ refused: "no Mac this box trusts signed it" });
    expect(acceptGrant({ ...real, version: 2 }, kit.ctx())).toEqual({ refused: "no Mac this box trusts signed it" });
  });

  it("refuses one that won't open under its purpose, or opens to something that isn't a 32-byte key", () => {
    const kit = grantKit();
    const other = kit.make(1, newSyncKey(), {}, grantPurpose(ORG, WORKER, 9));
    expect(acceptGrant(other, kit.ctx())).toEqual({ refused: "it doesn't open on this box" });
    const short = kit.make(1, Buffer.alloc(16).toString("base64"));
    expect(acceptGrant(short, kit.ctx())).toEqual({ refused: "it doesn't open on this box" });
    const notB64 = kit.make(1, "!".repeat(44));
    expect(acceptGrant(notB64, kit.ctx())).toEqual({ refused: "it doesn't open on this box" });
    // A sealed field that isn't JSON, or isn't a sealed box, signed all the same.
    for (const sealed of ["not json", JSON.stringify({ v: 2 })]) {
      const sig = kit.mac.sign(grantMessage({ orgId: ORG, workerId: WORKER, version: 1, boxKey: kit.keys.publicKey, sealed }));
      expect(acceptGrant({ ...kit.make(1), sealed, sig }, kit.ctx())).toEqual({ refused: "it doesn't open on this box" });
    }
  });

  it("signs over the sealed bytes' hash, so a message names exactly what was sealed", () => {
    const keys = newSealKeys();
    const sealed = JSON.stringify(seal(keys.publicKey, newSyncKey(), "p"));
    const m = grantMessage({ orgId: ORG, workerId: WORKER, version: 4, boxKey: keys.publicKey, sealed });
    expect(m.split("\n")).toEqual(["weft-worker-key-v1", ORG, WORKER, "4", keys.publicKey, expect.stringMatching(/^[0-9a-f]{64}$/)]);
  });
});
