import { describe, expect, it, vi } from "vitest";
import { PHONE_ONLY } from "./passkey-phone-only";
import { hostOfDevice, sendWiden, signWidenUrl, widenAskOf, widenAuth, widenToSign, type WidenAsk } from "./sign-widen";
import { widenMessage } from "./widen";
import { PASSKEY_TOO_WIDE } from "./widen-check";

const target = { orgId: "o1", device: "worker:w1", folder: "app", cardId: "c1" };
const ask: WidenAsk = { target, verb: "card.update", args: { body: { cwd: "site", note: "é ✓" } } };
const passkey = { device: "b1", credId: "cred" };
const sig = { authenticatorData: "YQ", clientDataJSON: "Yg", signature: "Yw" };

describe("the approve link", () => {
  it("carries the ask whole, unicode included, and reads it back", () => {
    const url = signWidenUrl("https://sign.weft.zip", ask);
    expect(url.startsWith("https://sign.weft.zip/approve?widen=")).toBe(true);
    expect(widenAskOf(new URL(url).search)).toEqual(ask);
  });

  it("reads nothing from a link that isn't whole", () => {
    const pack = (v: unknown) => `?widen=${btoa(JSON.stringify(v))}`;
    for (const bad of ["", "?card=c", "?widen=%%%", pack({ target: { ...target, orgId: "a b" }, verb: "card.update", args: {} }), pack({ target: { ...target, folder: 1 }, verb: "card.update", args: {} }), pack({ target, verb: "nope", args: {} }), pack({ target, verb: "card.update" }), pack({ verb: "card.update", args: {} })]) {
      expect(widenAskOf(bad)).toBeNull();
    }
  });
});

describe("widenToSign", () => {
  it("builds the message the host will rebuild, for a worker or a Mac", () => {
    const w = widenToSign(ask, passkey, 9, "abcdefghijklmnop");
    if (typeof w === "string") throw new Error(w);
    expect(w.host).toBe("w1");
    expect(w.change).toEqual({ cwd: "site" });
    expect(w.message).toBe(widenMessage({ host: "w1", card: "c1", verb: "card.update", change: { cwd: "site" }, nonce: "abcdefghijklmnop", issuedAt: 9 }));
    expect(widenAuth(w, sig)).toEqual({ kind: "webauthn", device: "b1", credId: "cred", issuedAt: 9, nonce: "abcdefghijklmnop", ...sig });
    expect(hostOfDevice("mac-dev")).toBe("mac-dev");
    const random = widenToSign(ask, passkey, 9);
    expect(typeof random === "string" ? random : random.nonce).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  it("says why it can't sign", () => {
    expect(widenToSign(ask, null, 1)).toMatch(/hasn't paired a passkey/);
    expect(widenToSign({ ...ask, args: { body: { title: "t" } } }, passkey, 1)).toMatch(/needs no approval/);
    expect(widenToSign({ ...ask, args: { body: { permissionMode: "bypassPermissions" } } }, passkey, 1)).toBe(PASSKEY_TOO_WIDE);
    expect(widenToSign({ ...ask, args: { body: { readScope: "/x" } } }, passkey, 1)).toBe(PASSKEY_TOO_WIDE);
    expect(widenToSign({ ...ask, verb: "card.shell", args: { command: "rm -rf ~/.claude" } }, passkey, 1)).toBe(PHONE_ONLY);
    expect(typeof widenToSign({ ...ask, verb: "card.shell", args: { command: "ls" } }, passkey, 1)).toBe("object");
  });
});

describe("sendWiden", () => {
  it("inserts the host row with the approval, and says why when it can't", async () => {
    const w = widenToSign(ask, passkey, 9, "abcdefghijklmnop");
    if (typeof w === "string") throw new Error(w);
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    const client = { from: () => ({ insert }) } as never;
    expect(await sendWiden(client, w, sig)).toBeNull();
    expect(insert).toHaveBeenCalledWith({ org_id: "o1", kind: "host", target_device: "worker:w1", folder: "app", payload: { verb: "card.update", args: { body: { cwd: "site", note: "é ✓" }, id: "c1", widen: widenAuth(w, sig) } } });
    const failing = { from: () => ({ insert: () => Promise.resolve({ error: { message: "denied" } }) }) } as never;
    expect(await sendWiden(failing, w, sig)).toMatch(/denied/);
  });
});
