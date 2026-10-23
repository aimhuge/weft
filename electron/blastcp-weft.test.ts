import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { exchangeWeft, WEFT_CLIENT } from "./blastcp-oauth.cjs";
import { AUTO_FILE, createBlastcp, TOKEN_FILE } from "./blastcp.cjs";

// Connecting BlastCP with your Weft account: the token exchange (blastcp-oauth.cjs) and connectWeft (blastcp.cjs).

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`w:${text}`),
  decryptString: (buf: Buffer) => buf.toString().slice(2),
};
const DAY = 24 * 60 * 60_000;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "blastcp-weft-"));

// One answer from blastcp.com/api/oauth/token, recording what was sent.
function tokenFetch(status: number, body: unknown) {
  const sent: Record<string, string>[] = [];
  const fetch = vi.fn((_url: string, init: { body: string }) => {
    sent.push(Object.fromEntries(new URLSearchParams(init.body)));
    return Promise.resolve({ ok: status < 400, status, json: () => (body === null ? Promise.reject(new Error("x")) : Promise.resolve(body)) });
  });
  return { fetch, sent };
}

// A fake BlastCP MCP endpoint that only answers whoami.
const mcp = () =>
  vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ result: { content: [{ type: "text", text: JSON.stringify({ email: "me@x.com" }) }] } }) }));

const swapped = (over: Record<string, unknown> = {}) => vi.fn(() => Promise.resolve({ token: "bc", expiresAt: Date.now() + 30 * DAY, clientId: WEFT_CLIENT, created: true, ...over }));

describe("exchangeWeft", () => {
  it("swaps the Weft token for a BlastCP one with the token-exchange grant", async () => {
    const { fetch, sent } = tokenFetch(200, { access_token: "bc", expires_in: 60, created: true });
    const before = Date.now();
    const got = await exchangeWeft({ fetch, subjectToken: "jwt" });
    expect(got).toMatchObject({ token: "bc", clientId: "weft", created: true });
    expect((got as { expiresAt: number }).expiresAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(sent[0]).toMatchObject({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: "jwt",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      client_id: "weft",
    });
    expect(await exchangeWeft({ fetch: tokenFetch(200, { access_token: "t" }).fetch, subjectToken: "j" })).toMatchObject({ expiresAt: null, created: false });
  });

  it("passes on BlastCP's link page, but only a BlastCP one", async () => {
    const link = "https://blastcp.com/link/weft?ticket=t";
    expect(await exchangeWeft({ fetch: tokenFetch(400, { error: "link_required", link_url: link }).fetch, subjectToken: "j" })).toEqual({ linkUrl: link });
    await expect(exchangeWeft({ fetch: tokenFetch(400, { error: "link_required", link_url: "https://evil.example/x" }).fetch, subjectToken: "j" })).rejects.toThrow("(400)");
  });

  it("is null on a BlastCP that can't swap yet, and throws BlastCP's reason otherwise", async () => {
    expect(await exchangeWeft({ fetch: tokenFetch(400, { error: "unsupported_grant_type" }).fetch, subjectToken: "j" })).toBeNull();
    expect(await exchangeWeft({ fetch: tokenFetch(401, { error: "invalid_client" }).fetch, subjectToken: "j" })).toBeNull();
    await expect(exchangeWeft({ fetch: tokenFetch(400, { error: "invalid_grant", error_description: "Weft email isn't verified" }).fetch, subjectToken: "j" })).rejects.toThrow("isn't verified");
    await expect(exchangeWeft({ fetch: tokenFetch(502, null).fetch, subjectToken: "j" })).rejects.toThrow("wouldn't take your Weft sign-in (502)");
  });
});

describe("connectWeft", () => {
  it("keeps the BlastCP sign-in sealed and says Weft made it", async () => {
    const dir = tmp();
    const swap = swapped();
    const blastcp = createBlastcp({ dataDir: dir, safeStorage, fetch: mcp(), swap });
    expect(await blastcp.connectWeft("jwt")).toEqual({ state: "connected", email: "me@x.com", created: true });
    expect(swap).toHaveBeenCalledWith(expect.objectContaining({ subjectToken: "jwt" }));
    const saved = JSON.parse(fs.readFileSync(path.join(dir, TOKEN_FILE), "utf8")) as { token: string; clientId: string };
    expect(saved.clientId).toBe("weft");
    expect(saved.token).not.toContain("bc");
    expect(await blastcp.status([])).toMatchObject({ signedIn: true, viaWeft: true, linkUrl: null });
    // Fresh, so the next tries leave it alone.
    expect(await blastcp.connectWeft("jwt")).toEqual({ state: "connected" });
    expect(swap).toHaveBeenCalledTimes(1);
  });

  it("renews its own sign-in in the last week, and never replaces one you made with Connect", async () => {
    const dir = tmp();
    const swap = swapped({ expiresAt: Date.now() + 3 * DAY });
    const blastcp = createBlastcp({ dataDir: dir, safeStorage, fetch: mcp(), swap });
    await blastcp.connectWeft("jwt");
    await blastcp.connectWeft("jwt");
    expect(swap).toHaveBeenCalledTimes(2);

    const mine = tmp();
    const login = vi.fn(() => Promise.resolve({ token: "manual", expiresAt: Date.now() + DAY, clientId: "mcp_1" }));
    const other = createBlastcp({ dataDir: mine, safeStorage, fetch: mcp(), swap, login });
    await other.connect();
    expect(await other.connectWeft("jwt")).toEqual({ state: "connected" });
    expect(swap).toHaveBeenCalledTimes(2);
    expect((await other.status([])).viaWeft).toBe(false);
    // The drawer's button (force) does replace it.
    expect(await other.connectWeft("jwt", { force: true })).toMatchObject({ state: "connected" });
    expect(swap).toHaveBeenCalledTimes(3);
  });

  it("stays off after Disconnect until the drawer's button asks", async () => {
    const dir = tmp();
    const swap = swapped();
    const blastcp = createBlastcp({ dataDir: dir, safeStorage, fetch: mcp(), swap });
    await blastcp.connectWeft("jwt");
    blastcp.forget();
    expect(JSON.parse(fs.readFileSync(path.join(dir, AUTO_FILE), "utf8"))).toEqual({ off: true });
    expect(await blastcp.connectWeft("jwt")).toEqual({ state: "off" });
    expect(swap).toHaveBeenCalledTimes(1);
    expect(await blastcp.connectWeft("jwt", { force: true })).toMatchObject({ state: "connected" });
    expect(JSON.parse(fs.readFileSync(path.join(dir, AUTO_FILE), "utf8"))).toEqual({ off: false });
  });

  it("holds the link page for the drawer until it connects, and says when BlastCP can't swap", async () => {
    const dir = tmp();
    const link = "https://blastcp.com/link/weft?ticket=t";
    const swap = vi.fn().mockResolvedValueOnce({ linkUrl: link }).mockResolvedValueOnce(null).mockImplementation(swapped());
    const blastcp = createBlastcp({ dataDir: dir, safeStorage, fetch: mcp(), swap });
    expect(await blastcp.connectWeft("jwt")).toEqual({ state: "link", linkUrl: link });
    expect((await blastcp.status([])).linkUrl).toBe(link);
    expect(await blastcp.connectWeft("jwt")).toEqual({ state: "unavailable" });
    await blastcp.connectWeft("jwt");
    expect((await blastcp.status([])).linkUrl).toBeNull();
  });

  it("wants a Weft token and the Keychain", async () => {
    const swap = swapped();
    await expect(createBlastcp({ dataDir: tmp(), safeStorage, swap }).connectWeft("")).rejects.toThrow("Sign in to your Weft account");
    const locked = createBlastcp({ dataDir: tmp(), safeStorage: { ...safeStorage, isEncryptionAvailable: () => false }, swap });
    await expect(locked.connectWeft("jwt")).rejects.toThrow("Keychain");
    expect(swap).not.toHaveBeenCalled();
  });
});
