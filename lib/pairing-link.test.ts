import { beforeAll, describe, expect, it } from "vitest";
import { checkClaim, claimMessage, makeClaim, newPairingSecret, PAIR_URL, pairingLink, parsePairingLink, type PairingLink } from "./pairing-link";
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

const body = () => ({ name: "Alex's iPhone", platform: "ios" as const, kind: "phone" as const, box_key: b64(s, s.crypto_box_keypair().publicKey), sign_key: signPub });

describe("pairing links", () => {
  it("round-trip with the secret in the fragment", () => {
    const url = pairingLink(link);
    expect(url.startsWith(`${PAIR_URL}#`)).toBe(true);
    expect(url.split("#")[0]).not.toContain(link.secret);
    expect(parsePairingLink(url)).toEqual(link);
  });
  it("refuse anything malformed", () => {
    const good = new URLSearchParams(pairingLink(link).split("#")[1]);
    expect(parsePairingLink("https://weft.zip/pair")).toBeNull();
    for (const [k, v] of [["v", "2"], ["p", "x"], ["o", "x"], ["s", "short"]] as const) {
      const q = new URLSearchParams(good);
      q.set(k, v);
      expect(parsePairingLink(`${PAIR_URL}#${q}`)).toBeNull();
    }
    const q = new URLSearchParams(good);
    q.delete("m");
    expect(parsePairingLink(`${PAIR_URL}#${q}`)?.mac).toBe("");
  });
  it("make 32-byte secrets", () => {
    expect(newPairingSecret(s)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("claims", () => {
  it("a device's claim checks out on the Mac", () => {
    expect(checkClaim(s, link, makeClaim(s, link, body(), signPriv))).toBeNull();
  });
  it("a claim made without the code fails its proof", () => {
    const claim = makeClaim(s, { ...link, secret: newPairingSecret(s) }, body(), signPriv);
    expect(checkClaim(s, link, claim)).toMatch(/wasn't made with this code/);
  });
  it("swapped keys fail", () => {
    const claim = makeClaim(s, link, body(), signPriv);
    expect(checkClaim(s, link, { ...claim, box_key: body().box_key })).toMatch(/wasn't made/);
    const other = b64(s, s.crypto_sign_keypair().publicKey);
    const forged = makeClaim(s, link, { ...body(), sign_key: other }, signPriv);
    expect(checkClaim(s, link, forged)).toMatch(/signature/);
  });
  it("missing, unknown or unreadable claims fail", () => {
    const claim = makeClaim(s, link, body(), signPriv);
    expect(checkClaim(s, link, { ...claim, sig: undefined })).toMatch(/missing/);
    expect(checkClaim(s, link, { ...claim, kind: "watch" as never })).toMatch(/unknown/);
    expect(checkClaim(s, link, { ...claim, proof: "!!" })).toMatch(/readable/);
  });
  it("the message lists the claim in order", () => {
    expect(claimMessage("p", "o", { name: "n", platform: "web", kind: "browser", box_key: "b", sign_key: "s" })).toBe("weft-pair-v1\np\no\nb\ns\nn\nweb\nbrowser");
  });
});
