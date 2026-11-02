import { describe, expect, it, vi } from "vitest";
import { deps, fakeDb, fakeGithub, iso, NOW, ticking } from "./connector.harness";
import { trustedMac } from "./connector-trust.harness";
import { CONFIRM_MS, confirmByLink, links, mailConfirm, matches, newToken, requestMeta, revokeByLink, tokenHash } from "./connector-signer-links";

function setup() {
  const clock = ticking();
  const { db, state } = fakeDb(clock);
  const notify = vi.fn(() => Promise.resolve());
  return { db, state, clock, notify, d: { ...deps(db, fakeGithub({}).fetch, clock), notify, site: "https://weft.test" } };
}

// A key waiting for its link, with the tokens the email carried.
function pending(state: ReturnType<typeof setup>["state"], o: { expiresAt?: number } = {}) {
  const mac = trustedMac(state, "u1", { trustedFrom: null });
  const confirm = newToken();
  const revoke = newToken();
  Object.assign(mac.signer, { confirm_hash: tokenHash(confirm), confirm_expires_at: iso(o.expiresAt ?? NOW + CONFIRM_MS), revoke_hashes: [tokenHash(newToken()), tokenHash(revoke)] });
  return { mac, confirm, revoke };
}

describe("requestMeta", () => {
  it("reads the forwarded address and the client, cleaned and capped", () => {
    expect(requestMeta(new Request("https://x", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "Wefté/1" } }))).toEqual({ ip: "203.0.113.9", ua: "Weft?/1" });
    expect(requestMeta(new Request("https://x", { headers: { "x-real-ip": "198.51.100.2" } }))).toEqual({ ip: "198.51.100.2", ua: "unknown" });
    expect(requestMeta(new Request("https://x"))).toEqual({ ip: "unknown", ua: "unknown" });
  });
});

describe("matches and links", () => {
  it("matches a token to its kept hash, and nothing else", () => {
    const t = newToken();
    expect(matches(tokenHash(t), t)).toBe(true);
    expect(matches(tokenHash(t), newToken())).toBe(false);
    expect(matches(null, t)).toBe(false);
    expect(matches(tokenHash(t), 5)).toBe(false);
    expect(matches(tokenHash(t), "")).toBe(false);
    expect(matches("short", t)).toBe(false);
  });

  it("builds both links on weft.zip by default", () => {
    expect(links("s 1", "c", "r", "https://weft.test")).toEqual({ confirm: "https://weft.test/api/connectors/signers/confirm#id=s%201&t=c", revoke: "https://weft.test/api/connectors/signers/revoke#id=s%201&t=r" });
    expect(links("s", "c", "r").confirm.startsWith("https://")).toBe(true);
  });
});

describe("mailConfirm", () => {
  it("refuses with no mailer", async () => {
    const { d, state } = setup();
    const { mac } = pending(state);
    await expect(mailConfirm({ ...d, notify: undefined }, mac.signer, { confirm: "c", revoke: "r" }, { ip: "i", ua: "u" }, NOW)).rejects.toMatchObject({ status: 503 });
  });
});

describe("confirmByLink", () => {
  it("trusts the key once, from the emailed link, and tells you", async () => {
    const { d, state, notify } = setup();
    const { mac, confirm } = pending(state);
    await confirmByLink(d, mac.signer.id, confirm);
    expect(state.signers[0]).toMatchObject({ endorsed_by: null, confirm_hash: null });
    expect(state.signers[0]!.trusted_from).toBeTruthy();
    expect(notify).toHaveBeenCalledWith("u1", "Weft: a Mac key was confirmed for connectors", expect.any(String));
    await expect(confirmByLink(d, mac.signer.id, confirm)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a wrong, expired or revoked key's link, or no id", async () => {
    const { d, state } = setup();
    const { mac, confirm } = pending(state);
    await expect(confirmByLink(d, mac.signer.id, newToken())).rejects.toMatchObject({ status: 404 });
    await expect(confirmByLink(d, 5, confirm)).rejects.toMatchObject({ status: 404 });
    await expect(confirmByLink(d, "nope", confirm)).rejects.toMatchObject({ status: 404 });
    const old = pending(state, { expiresAt: NOW - 1 });
    await expect(confirmByLink(d, old.mac.signer.id, old.confirm)).rejects.toMatchObject({ status: 404 });
    old.mac.signer.confirm_expires_at = null;
    await expect(confirmByLink(d, old.mac.signer.id, old.confirm)).rejects.toMatchObject({ status: 404 });
    mac.signer.revoked_at = iso(NOW);
    await expect(confirmByLink(d, mac.signer.id, confirm)).rejects.toMatchObject({ status: 404 });
  });
});

describe("revokeByLink", () => {
  it("revokes the key with no session, once, and refuses another token", async () => {
    const { d, state } = setup();
    const { mac, revoke } = pending(state);
    const done = vi.fn(() => Promise.resolve());
    await revokeByLink(d, mac.signer.id, revoke, done);
    expect(done).toHaveBeenCalledWith(d, "u1", mac.signer.id);
    mac.signer.revoked_at = iso(NOW);
    await revokeByLink(d, mac.signer.id, revoke, done);
    expect(done).toHaveBeenCalledTimes(1);
    await expect(revokeByLink(d, mac.signer.id, newToken(), done)).rejects.toMatchObject({ status: 404 });
    await expect(revokeByLink(d, undefined, revoke, done)).rejects.toMatchObject({ status: 404 });
    delete mac.signer.revoke_hashes;
    await expect(revokeByLink(d, mac.signer.id, revoke, done)).rejects.toMatchObject({ status: 404 });
  });
});
