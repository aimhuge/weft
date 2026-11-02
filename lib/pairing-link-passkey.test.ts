import { beforeAll, describe, expect, it } from "vitest";
import { checkClaim, claimMessage, makeClaim, newPairingSecret, type PairingLink } from "./pairing-link";
import { b64, sodium, type Sodium } from "./sodium";

let s: Sodium;
let link: PairingLink;
let signPriv: string;
let signPub: string;
beforeAll(async () => {
  s = await sodium();
  link = { id: "11111111-2222-4333-8444-555555555555", orgId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", secret: newPairingSecret(s), mac: "ab:cd" };
  const pair = s.crypto_sign_keypair();
  signPriv = b64(s, pair.privateKey);
  signPub = b64(s, pair.publicKey);
});

const body = () => ({ name: "Alex · Safari", platform: "web" as const, kind: "browser" as const, box_key: "Ym94", sign_key: signPub, passkey_id: "Y3JlZA", passkey_key: "c3BraQ" });

describe("a browser's claim with a passkey", () => {
  it("puts the passkey in the message, so the proof covers it", () => {
    expect(claimMessage("p", "o", body())).toBe(`weft-pair-v1\np\no\nYm94\n${signPub}\nAlex · Safari\nweb\nbrowser\npasskey:Y3JlZA\nc3BraQ`);
    expect(checkClaim(s, link, makeClaim(s, link, body(), signPriv))).toBeNull();
  });

  it("fails when the server swaps or drops the passkey", () => {
    const claim = makeClaim(s, link, body(), signPriv);
    expect(checkClaim(s, link, { ...claim, passkey_key: "b3RoZXI" })).toMatch(/wasn't made/);
    expect(checkClaim(s, link, { ...claim, passkey_id: "b3RoZXI" })).toMatch(/wasn't made/);
    expect(checkClaim(s, link, { ...claim, passkey_id: undefined, passkey_key: undefined })).toMatch(/wasn't made/);
  });

  it("needs both halves, and only a browser has one", () => {
    const claim = makeClaim(s, link, body(), signPriv);
    expect(checkClaim(s, link, { ...claim, passkey_key: undefined })).toMatch(/passkey is incomplete/);
    expect(checkClaim(s, link, { ...claim, kind: "phone" })).toMatch(/passkey is incomplete/);
  });
});
