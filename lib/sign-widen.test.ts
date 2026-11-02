import { describe, expect, it, vi } from "vitest";
import { PHONE_ONLY } from "./passkey-phone-only";
import { argsFromChange, hostOfDevice, loadWidenCard, sendWiden, signWidenUrl, widenAskOf, widenAuth, widenToSign, type WidenAsk } from "./sign-widen";
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
    // The args are rebuilt from the change: the link's `note` beside it is neither signed nor sent.
    expect(w.args).toEqual({ body: { cwd: "site" }, id: "c1" });
    expect(w.message).toBe(widenMessage({ host: "w1", card: "c1", verb: "card.update", change: { cwd: "site" }, args: { body: { cwd: "site" } }, nonce: "abcdefghijklmnop", issuedAt: 9 }));
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
    expect(widenToSign({ ...ask, verb: "card.schedule", args: { text: "!ls", at: "soon" } }, passkey, 1)).toMatch(/can't be approved here/);
  });

  it("keeps a \"!\" line's send-at time, and nothing else the link carried", () => {
    const w = widenToSign({ ...ask, verb: "card.schedule", args: { text: "!ls", at: 50, extra: 1 } }, passkey, 1, "abcdefghijklmnop");
    expect(typeof w === "string" ? w : w.args).toEqual({ text: "!ls", at: 50, id: "c1" });
    expect(argsFromChange("card.shell", { shell: "ls" }, { command: "rm" })).toEqual({ command: "ls" });
    expect(argsFromChange("terminal.open", { terminal: "a" }, {})).toBeNull();
  });
});

describe("sendWiden", () => {
  it("inserts the host row with the approval, and says why when it can't", async () => {
    const w = widenToSign(ask, passkey, 9, "abcdefghijklmnop");
    if (typeof w === "string") throw new Error(w);
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    const client = { from: () => ({ insert }) } as never;
    expect(await sendWiden(client, w, sig)).toBeNull();
    expect(insert).toHaveBeenCalledWith({ org_id: "o1", kind: "host", target_device: "worker:w1", folder: "app", payload: { verb: "card.update", args: { body: { cwd: "site" }, id: "c1", widen: widenAuth(w, sig) } } });
    const failing = { from: () => ({ insert: () => Promise.resolve({ error: { message: "denied" } }) }) } as never;
    expect(await sendWiden(failing, w, sig)).toMatch(/denied/);
  });
});

describe("loadWidenCard", () => {
  const rows = (data: unknown[] | null, error: { message: string } | null = null) => ({ from: () => ({ select: () => ({ eq: () => ({ overrideTypes: () => Promise.resolve({ data, error }) }) }) }) }) as never;
  const row = { org_id: "o1", card_id: "c1", owner_device: "worker:w1", owner_user: "u1", folder: "app", card: { title: "Fix login" }, deleted: false };

  it("names the card by its title and folder as this page reads it", async () => {
    expect(await loadWidenCard(rows([row]), ask, "u1")).toEqual({ title: "Fix login", folder: "app" });
    expect(await loadWidenCard(rows([{ ...row, card: {} }]), ask, "u1")).toEqual({ title: "(untitled)", folder: "app" });
  });

  it("refuses a card that isn't this account's on the host and folder the link names", async () => {
    expect(await loadWidenCard(rows([row]), ask, "u2")).toMatch(/another account's/);
    expect(await loadWidenCard(rows([{ ...row, owner_user: null }]), ask, "u1")).toMatch(/another account's/);
    expect(await loadWidenCard(rows([{ ...row, owner_device: "worker:w2" }]), ask, "u1")).toMatch(/isn't one of yours/);
    expect(await loadWidenCard(rows([{ ...row, folder: "other" }]), ask, "u1")).toMatch(/isn't one of yours/);
    expect(await loadWidenCard(rows([{ ...row, deleted: true }]), ask, "u1")).toMatch(/isn't one of yours/);
    expect(await loadWidenCard(rows(null, { message: "denied" }), ask, "u1")).toMatch(/denied/);
  });
});
