// Main's copy of the passkey verifier agrees with lib/passkey-verify.ts on every vector: same verdict, same reason.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { authData, makePasskey, type Build, type TestPasskey } from "../lib/passkey.harness";
import { passkeyOrigins as tsOrigins, verifyPasskeyAssertion as tsVerify } from "../lib/passkey-verify";
import { passkeyDevOrigin, passkeyOrigins, verifyPasskeyAssertion } from "./passkey-verify.cjs";

let passkey: TestPasskey;
let other: TestPasskey;
beforeAll(async () => {
  passkey = await makePasskey();
  other = await makePasskey();
});

const MESSAGE = '{"v":"weft-passkey-approval-v1"}';

describe("main's passkey verifier", () => {
  it("agrees with the TypeScript on good and bad assertions", async () => {
    const cases: [Build, number, string?][] = [
      [{}, 0],
      [{ auth: await authData({ counter: 3 }) }, 2],
      [{ auth: await authData({ counter: 3 }) }, 3],
      [{ auth: await authData({ flags: 0x01 }) }, 0],
      [{ auth: await authData({ rpId: "evil.com" }) }, 0],
      [{ auth: await authData({ rpId: "weft.zip" }) }, 0],
      [{ client: { origin: "https://weft.zip" } }, 0],
      [{ auth: new Uint8Array(10) }, 0],
      [{ client: { origin: "https://evil.example" } }, 0],
      [{ client: { crossOrigin: true } }, 0],
      [{ client: { type: "webauthn.create" } }, 0],
      [{ client: "[1" }, 0],
      [{ client: "null" }, 0],
      [{ der: (d) => d.subarray(1) }, 0],
      [{ key: other.keys.privateKey }, 0],
      [{}, 0, `${MESSAGE} `],
    ];
    for (const [build, counter, message = MESSAGE] of cases) {
      const a = await passkey.sign(MESSAGE, build);
      const pin = { publicKey: passkey.publicKey, counter };
      expect(verifyPasskeyAssertion(a, pin, message, passkeyOrigins(null))).toEqual(await tsVerify(a, pin, message, tsOrigins({})));
    }
    const a = await passkey.sign(MESSAGE);
    // Both decoders take exactly the same strings: a 4n+1 length or stray bits in the last character is unreadable.
    for (const bad of [`${a.signature}A`, `${a.signature.slice(0, -1)}${a.signature.endsWith("B") ? "C" : "B"}`, `${a.authenticatorData}AAAAA`, "AB", "+/"]) {
      const broken = { ...a, signature: bad };
      expect(verifyPasskeyAssertion(broken, { publicKey: passkey.publicKey, counter: 0 }, MESSAGE, passkeyOrigins(null))).toEqual(await tsVerify(broken, { publicKey: passkey.publicKey, counter: 0 }, MESSAGE, tsOrigins({})));
    }
    expect(verifyPasskeyAssertion({ ...a, signature: "a+b" }, { publicKey: passkey.publicKey, counter: 0 }, MESSAGE, passkeyOrigins(null))).toMatchObject({ ok: false, reason: "The passkey's answer isn't readable." });
    expect(verifyPasskeyAssertion(a, { publicKey: "AAAA", counter: 0 }, MESSAGE, passkeyOrigins(null))).toMatchObject({ ok: false });
  });

  it("takes a dev origin only when main passes one", async () => {
    expect(passkeyOrigins("http://localhost:5001")).toEqual(tsOrigins({ WEFT_PASSKEY_DEV_ORIGIN: "http://localhost:5001" }));
    expect(passkeyOrigins("not a url")).toEqual(passkeyOrigins(null));
    const a = await passkey.sign(MESSAGE, { client: { origin: "http://localhost:5001" }, auth: await authData({ rpId: "localhost" }) });
    expect(verifyPasskeyAssertion(a, { publicKey: passkey.publicKey, counter: 0 }, MESSAGE, passkeyOrigins("http://localhost:5001")).ok).toBe(true);
    expect(verifyPasskeyAssertion(a, { publicKey: passkey.publicKey, counter: 0 }, MESSAGE, passkeyOrigins(null)).ok).toBe(false);
  });

  it("takes a dev origin only unpackaged, with WEFT_PASSKEY_DEV=1, and warns", () => {
    const warn = vi.fn();
    const env = { WEFT_PASSKEY_DEV: "1", WEFT_PASSKEY_DEV_ORIGIN: "http://sign.localhost:5001" };
    expect(passkeyDevOrigin({ packaged: false, env, warn })).toBe("http://sign.localhost:5001");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("http://sign.localhost:5001"));
    warn.mockClear();
    expect(passkeyDevOrigin({ packaged: true, env, warn })).toBeNull();
    expect(passkeyDevOrigin({ packaged: false, env: { WEFT_PASSKEY_DEV_ORIGIN: "http://x" }, warn })).toBeNull();
    expect(passkeyDevOrigin({ packaged: false, env: { WEFT_PASSKEY_DEV: "1" }, warn })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
