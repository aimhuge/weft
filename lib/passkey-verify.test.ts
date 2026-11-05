import { beforeAll, describe, expect, it } from "vitest";
import { authData, makePasskey, rawToDer, type Build, type TestPasskey } from "./passkey.harness";
import { derToRaw, fromB64url, passkeyOrigins, toB64url, verifyPasskeyAssertion, PASSKEY_ORIGIN, PASSKEY_RP_ID, type PasskeyAssertion, type PasskeyResult, type PinnedPasskey } from "./passkey-verify";

// A real authenticator's work, done by hand (lib/passkey.harness.ts): a P-256 key, authenticatorData, clientDataJSON
// and a DER signature.
let passkey: TestPasskey;
let pinned: PinnedPasskey;
const ORIGINS = passkeyOrigins({});
const MESSAGE = "weft-approval-v1\no\nm\nc\np\nallow\n1\n-\ntool:Bash\ninput:ab";

const assertion = ({ message = MESSAGE, ...build }: Build & { message?: string } = {}) => passkey.sign(message, build);

beforeAll(async () => {
  passkey = await makePasskey();
  pinned = { publicKey: passkey.publicKey, counter: 0 };
});

const why = (r: PasskeyResult) => (r.ok ? "" : r.reason);
const verify = (a: PasskeyAssertion, over: Partial<PinnedPasskey> = {}, message = MESSAGE, origins = ORIGINS) => verifyPasskeyAssertion(a, { ...pinned, ...over }, message, origins);

describe("verifyPasskeyAssertion", () => {
  it("takes the pinned key's signature over the message", async () => {
    expect(await verify(await assertion())).toEqual({ ok: true, counter: 0 });
  });

  it("returns a counter that moved on, and refuses one that didn't", async () => {
    const a = await assertion({ auth: await authData({ counter: 7 }) });
    expect(await verify(a, { counter: 6 })).toEqual({ ok: true, counter: 7 });
    expect(why(await verify(a, { counter: 7 }))).toMatch(/counter/);
    expect(why(await verify(await assertion(), { counter: 3 }))).toMatch(/counter/);
  });

  it("refuses another message, origin, type or a cross-origin frame", async () => {
    expect(why(await verify(await assertion(), {}, `${MESSAGE}x`))).toMatch(/different approval/);
    expect(why(await verify(await assertion({ client: { origin: "https://weft.zip.evil.com" } })))).toMatch(/another site/);
    expect(why(await verify(await assertion({ client: { crossOrigin: true } })))).toMatch(/another site/);
    expect(why(await verify(await assertion({ client: { type: "webauthn.create" } })))).toMatch(/isn't a passkey/);
    expect(why(await verify(await assertion({ client: "[1" })))).toMatch(/isn't a passkey/);
    expect(why(await verify(await assertion({ client: "null" })))).toMatch(/isn't a passkey/);
  });

  it("takes sign.weft.zip only: weft.zip's own origin or rp id is refused", async () => {
    expect(why(await verify(await assertion({ client: { origin: "https://weft.zip" } })))).toMatch(/another site/);
    expect(why(await verify(await assertion({ auth: await authData({ rpId: "weft.zip" }) })))).toMatch(/belongs to another site/);
  });

  it("refuses another rp id, or short authenticatorData", async () => {
    expect(why(await verify(await assertion({ auth: await authData({ rpId: "evil.com" }) })))).toMatch(/belongs to another site/);
    expect(why(await verify(await assertion({ auth: new Uint8Array(36) })))).toMatch(/belongs to another site/);
  });

  it("needs the user present and verified", async () => {
    expect(why(await verify(await assertion({ auth: await authData({ flags: 0x01 }) })))).toMatch(/Touch ID/);
    expect(why(await verify(await assertion({ auth: await authData({ flags: 0x04 }) })))).toMatch(/Touch ID/);
  });

  it("refuses another key's signature, a broken one, or a broken pinned key", async () => {
    const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    expect(why(await verify(await assertion({ key: other.privateKey })))).toMatch(/signature/);
    expect(why(await verify(await assertion({ der: (d) => d.subarray(1) })))).toMatch(/signature/);
    expect(why(await verify(await assertion(), { publicKey: "AAAA" }))).toMatch(/signature/);
  });

  it("refuses parts that aren't base64url", async () => {
    expect(why(await verify({ ...(await assertion()), signature: "a+b/" }))).toMatch(/readable/);
  });

  it("takes the dev origin only when it's allowed", async () => {
    const dev = passkeyOrigins({ WEFT_PASSKEY_DEV_ORIGIN: "http://localhost:5001" });
    const a = await assertion({ client: { origin: "http://localhost:5001" }, auth: await authData({ rpId: "localhost" }) });
    expect(await verify(a, {}, MESSAGE, dev)).toMatchObject({ ok: true });
    expect(await verify(a)).toMatchObject({ ok: false });
  });
});

describe("passkeyOrigins", () => {
  it("is weft.zip alone in production, or without a dev origin, or with a broken one", () => {
    const only = [{ origin: PASSKEY_ORIGIN, rpId: PASSKEY_RP_ID }];
    expect(passkeyOrigins({})).toEqual(only);
    expect(passkeyOrigins({ NODE_ENV: "production", WEFT_PASSKEY_DEV_ORIGIN: "http://localhost:5001" })).toEqual(only);
    expect(passkeyOrigins({ WEFT_PASSKEY_DEV_ORIGIN: "not a url" })).toEqual(only);
    expect(passkeyOrigins({ WEFT_PASSKEY_DEV_ORIGIN: "http://localhost:5001/x" })).toEqual([...only, { origin: "http://localhost:5001", rpId: "localhost" }]);
  });
});

describe("derToRaw", () => {
  const r = new Uint8Array(32).fill(0x81);
  const s = new Uint8Array(32).fill(0x01);
  const good = rawToDer(new Uint8Array([...r, ...s]));

  it("strips the sign byte and pads short integers", () => {
    expect(derToRaw(good)).toEqual(new Uint8Array([...r, ...s]));
    const short = new Uint8Array([0x30, 6, 0x02, 1, 5, 0x02, 1, 9]);
    const raw = derToRaw(short) as Uint8Array;
    expect([raw[31], raw[63], raw[0]]).toEqual([5, 9, 0]);
  });

  it("refuses what isn't a two-integer sequence", () => {
    expect(derToRaw(new Uint8Array([0x31, ...good.subarray(1)]))).toBeNull();
    expect(derToRaw(good.subarray(0, good.length - 1))).toBeNull();
    expect(derToRaw(new Uint8Array([0x30, 3, 0x03, 1, 5]))).toBeNull();
    expect(derToRaw(new Uint8Array([0x30, 1, 0x02]))).toBeNull();
    expect(derToRaw(new Uint8Array([0x30, 3, 0x02, 1, 5]))).toBeNull();
    expect(derToRaw(new Uint8Array([0x30, 4, 0x02, 0, 0x02, 0]))).toBeNull();
    expect(derToRaw(new Uint8Array([0x30, 4, 0x02, 5, 1, 2]))).toBeNull();
    expect(derToRaw(new Uint8Array([0x30, 37, 0x02, 33, ...new Uint8Array(33).fill(1), 0x02, 0]))).toBeNull();
    expect(derToRaw(new Uint8Array([0x30, 7, 0x02, 1, 5, 0x02, 1, 9, 0]))).toBeNull();
  });
});

describe("base64url", () => {
  it("round-trips bytes and refuses other alphabets", () => {
    const bytes = new Uint8Array([251, 255, 0, 1]);
    expect(fromB64url(toB64url(bytes))).toEqual(bytes);
    expect(() => fromB64url("+/")).toThrow();
  });
  it("refuses non-canonical strings: a 4n+1 length, or stray bits in the last character", () => {
    expect(() => fromB64url("AAAAA")).toThrow();
    expect(() => fromB64url("AB")).toThrow(/canonical/);
    expect(() => fromB64url("AAB")).toThrow(/canonical/);
    expect(fromB64url("AA")).toEqual(new Uint8Array([0]));
    expect(fromB64url("")).toEqual(new Uint8Array([]));
  });
});
