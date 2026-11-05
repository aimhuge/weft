import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { makePasskey, type TestPasskey } from "./passkey.harness";
import { fromB64url, passkeyOrigins, toB64url, verifyPasskeyAssertion } from "./passkey-verify";
import { createPasskey, passkeysAvailable, signWithPasskey } from "./web-passkey";

let passkey: TestPasskey;
beforeAll(async () => {
  passkey = await makePasskey();
});
afterEach(() => vi.unstubAllGlobals());

const CRED = new Uint8Array([1, 2, 3]);
const buffer = (bytes: Uint8Array) => bytes.slice().buffer;

function browser(credentials: Partial<CredentialsContainer>) {
  vi.stubGlobal("window", { PublicKeyCredential: function PublicKeyCredential() {} });
  vi.stubGlobal("navigator", { credentials });
}

describe("passkeysAvailable", () => {
  it("needs a window with WebAuthn", () => {
    expect(passkeysAvailable()).toBe(false);
    vi.stubGlobal("window", {});
    expect(passkeysAvailable()).toBe(false);
    browser({});
    expect(passkeysAvailable()).toBe(true);
  });
});

describe("createPasskey", () => {
  const made = (over: Record<string, unknown> = {}) => ({ rawId: buffer(CRED), response: { getPublicKey: () => buffer(fromB64url(passkey.publicKey)), getPublicKeyAlgorithm: () => -7, ...over } });

  it("asks for an ES256 passkey with user verification, and returns its id and SPKI key", async () => {
    const create = vi.fn(() => Promise.resolve(made()));
    browser({ create } as never);
    expect(await createPasskey({ id: "u1", name: "Alex" }, "sign.weft.zip")).toEqual({ credId: toB64url(CRED), publicKey: passkey.publicKey });
    const options = (create.mock.calls[0] as unknown as [{ publicKey: PublicKeyCredentialCreationOptions }])[0].publicKey;
    expect(options.rp).toEqual({ id: "sign.weft.zip", name: "Weft" });
    expect(options.pubKeyCredParams).toEqual([{ type: "public-key", alg: -7 }]);
    expect(options.authenticatorSelection).toEqual({ userVerification: "required", residentKey: "preferred" });
    expect(options.user.name).toBe("Alex");
  });

  it("is null without WebAuthn, without a credential, a public key or ES256", async () => {
    expect(await createPasskey({ id: "u", name: "" }, "sign.weft.zip")).toBeNull();
    browser({ create: () => Promise.resolve(null) });
    expect(await createPasskey({ id: "u", name: "" }, "sign.weft.zip")).toBeNull();
    browser({ create: () => Promise.resolve(made({ getPublicKey: () => null })) } as never);
    expect(await createPasskey({ id: "u", name: "" }, "sign.weft.zip")).toBeNull();
    browser({ create: () => Promise.resolve(made({ getPublicKey: undefined })) } as never);
    expect(await createPasskey({ id: "u", name: "" }, "sign.weft.zip")).toBeNull();
    browser({ create: () => Promise.resolve(made({ getPublicKeyAlgorithm: () => -8 })) } as never);
    expect(await createPasskey({ id: "u", name: "" }, "sign.weft.zip")).toBeNull();
  });
});

describe("signWithPasskey", () => {
  it("signs SHA-256(message) with that credential, in a form the host verifies", async () => {
    const message = "weft-approval-v1\nx";
    const assertion = await passkey.sign(message);
    const get = vi.fn(() =>
      Promise.resolve({ response: { authenticatorData: buffer(fromB64url(assertion.authenticatorData)), clientDataJSON: buffer(fromB64url(assertion.clientDataJSON)), signature: buffer(fromB64url(assertion.signature)) } }),
    );
    browser({ get } as never);
    const sig = await signWithPasskey(toB64url(CRED), message, "sign.weft.zip");
    expect(sig).toEqual(assertion);
    const options = (get.mock.calls[0] as unknown as [{ publicKey: PublicKeyCredentialRequestOptions }])[0].publicKey;
    expect(options.userVerification).toBe("required");
    expect(options.rpId).toBe("sign.weft.zip");
    expect(new Uint8Array(options.allowCredentials![0]!.id as Uint8Array)).toEqual(CRED);
    expect(await verifyPasskeyAssertion(sig, { publicKey: passkey.publicKey, counter: 0 }, message, passkeyOrigins({}))).toMatchObject({ ok: true });
  });

  it("throws without WebAuthn or a signature", async () => {
    await expect(signWithPasskey("AQ", "m", "sign.weft.zip")).rejects.toThrow(/can't use passkeys/);
    browser({ get: () => Promise.resolve(null) });
    await expect(signWithPasskey("AQ", "m", "sign.weft.zip")).rejects.toThrow(/didn't sign/);
  });
});
