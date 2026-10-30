import { afterEach, describe, expect, it, vi } from "vitest";
import { handle, keptHeaders, MAX_BODY, restStore, type Relay, type RelayStore } from "./webhook-relay";
import { hmacHex, hmacSha256Hex } from "./webhook-signatures-hmac";
import { openSecret, relayKeyFromEnv, sealSecret, sealedFromHex, sealedToHex } from "./relay-secret";

// The webhook relay's checks (the relay id, the size, which headers survive, the provider signature, and
// the encryption of the signing secret on the row) and its Supabase store (lib/webhook-relay.test.ts).
// The relay used to save every request it received; a stranger holding the id could write to the owner's
// localhost target. It now refuses anything that doesn't carry the provider's signature
// (lib/webhook-signatures.ts), and the secret in the row is sealed at rest with WEFT_RELAY_SECRET_KEY
// (lib/relay-secret.ts), so a Supabase read alone won't let anyone forge (pentest 2026-10-20, F-12).

const ID = "6f1c2a7e-0b8d-4c3e-9a51-2d7f00c1b9aa";
const KEY_ID = "v1";
// 32-byte AES key. Stable hex so the suite is reproducible.
const KEY = Buffer.from("11".repeat(32), "hex");
const KEY_HEX = KEY.toString("hex");
const ENV = { WEFT_RELAY_SECRET_KEY: KEY_HEX, WEFT_RELAY_SECRET_KEY_ID: KEY_ID } as Record<string, string>;
const KEY_FROM_ENV = relayKeyFromEnv(ENV)!;

function sealed(plain: string, provider = "stripe"): Relay {
  const s = sealSecret(plain, KEY_FROM_ENV);
  const hex = sealedToHex(s);
  return { id: ID, user_id: "u1", name: provider, provider, ...hex };
}

function store(relay: Relay | null = sealed("whsec_test")): RelayStore & { save: ReturnType<typeof vi.fn> } {
  return { relay: vi.fn(() => Promise.resolve(relay)), save: vi.fn(() => Promise.resolve()) };
}

const req = (method = "POST", body: BodyInit | undefined = "{}", headers: Record<string, string> = {}) =>
  new Request(`https://weft.example/api/hooks/${ID}`, { method, headers, body: method === "GET" ? undefined : body });

function stripeSigned(secret: string, body: string, t: number): Request {
  // What Stripe sends, formatted the same way Stripe signs: `t=<unix>,v1=<hex>`. The relay parses the
  // header so a wrong shape is refused the same way it would be in production.
  const sig = hmacHex(secret, `${t}.${body}`);
  return new Request(`https://weft.example/api/hooks/${ID}`, {
    method: "POST",
    headers: { "stripe-signature": `t=${t},v1=${sig}`, "content-type": "application/json" },
    body,
  });
}

describe("keptHeaders", () => {
  it("never passes the local API's write header from a stranger", () => {
    expect(keptHeaders(new Headers({ "x-weft-token": "1", "content-type": "text/plain" }))).toEqual({ "content-type": "text/plain" });
  });

  it("lowercases and drops hop-by-hop and Vercel's own headers", () => {
    const headers = new Headers({
      "Stripe-Signature": "t=1,v1=abc",
      "Content-Type": "application/json",
      Host: "weft.example",
      Connection: "close",
      "Content-Length": "2",
      "Transfer-Encoding": "chunked",
      "X-Forwarded-For": "1.2.3.4",
      "X-Forwarded-Proto": "https",
      "X-Vercel-Id": "iad1::x",
      "X-Real-IP": "1.2.3.4",
      Forwarded: "for=1.2.3.4",
    });
    expect(keptHeaders(headers)).toEqual({ "stripe-signature": "t=1,v1=abc", "content-type": "application/json" });
  });
});

describe("handle", () => {
  it("accepts a Stripe-signed POST with a secret the relay opens, writing the same bytes", async () => {
    const t = 1_700_000_000;
    const s = store();
    const res = await handle(stripeSigned("whsec_test", '{"a":1}', t), ID, "?foo=1", s, { key: KEY_FROM_ENV, now: () => t * 1000 });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Relayed");
    expect(s.relay).toHaveBeenCalledWith(ID);
    expect(s.save).toHaveBeenCalledWith({
      relay_id: ID,
      user_id: "u1",
      method: "POST",
      path: "?foo=1",
      headers: { "stripe-signature": `t=${t},v1=${hmacHex("whsec_test", `${t}.{"a":1}`)}`, "content-type": "application/json" },
      body: Buffer.from('{"a":1}').toString("base64"),
    });
  });

  it("keeps the body's bytes exactly so the local target can verify too", async () => {
    const bytes = new Uint8Array([0, 255, 128, 10, 13]);
    const t = 1_700_000_000;
    const sig = hmacHex("whsec_test", `${t}.${new TextDecoder().decode(bytes)}`);
    const r = new Request(`https://weft.example/api/hooks/${ID}`, {
      method: "POST",
      headers: { "stripe-signature": `t=${t},v1=${sig}` },
      body: bytes,
    });
    const s = store();
    expect((await handle(r, ID, "", s, { key: KEY_FROM_ENV, now: () => t * 1000 })).status).toBe(200);
    const saved = s.save.mock.calls[0]?.[0] as { body: string };
    expect([...Buffer.from(saved.body, "base64")]).toEqual([...bytes]);
  });

  it("refuses a GET challenge (no Stripe signature) as missing the signature header", async () => {
    // Stripe's URL verification is a GET with no body; the relay never accepted GETs without a
    // signature anyway, and now even the pre-verifications that other providers send fail without one.
    const s = store();
    expect((await handle(req("GET"), ID, "", s, { key: KEY_FROM_ENV })).status).toBe(401);
    expect(s.save).not.toHaveBeenCalled();
  });

  it("refuses what it can't relay even before reading the body", async () => {
    const s = store();
    expect((await handle(req("OPTIONS"), ID, "", s, { key: KEY_FROM_ENV })).status).toBe(405);
    expect((await handle(req("POST", "{}"), "not-a-uuid", "", s, { key: KEY_FROM_ENV })).status).toBe(404);
    expect((await handle(req("POST", "{}"), ID, "", store(null), { key: KEY_FROM_ENV })).status).toBe(404);
    expect(s.save).not.toHaveBeenCalled();
  });

  it("refuses a body over 1 MB, declared or actual", async () => {
    const s = store();
    expect((await handle(req("POST", "x", { "content-length": String(MAX_BODY + 1) }), ID, "", s, { key: KEY_FROM_ENV })).status).toBe(413);
    expect((await handle(req("POST", "x".repeat(MAX_BODY + 1)), ID, "", s, { key: KEY_FROM_ENV })).status).toBe(413);
    expect(s.save).not.toHaveBeenCalled();
  });

  it("refuses when the row has no provider (legacy relay after migration)", async () => {
    const empty: Relay = { id: ID, user_id: "u1", name: "stripe" };
    const s = store(empty);
    const res = await handle(stripeSigned("whsec_test", "{}", 1_700_000_000), ID, "", s, { key: KEY_FROM_ENV, now: () => 1_700_000_000 * 1000 });
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/create a fresh relay through Weft/);
    expect(s.save).not.toHaveBeenCalled();
  });

  it("refuses when the row's provider isn't in the registry", async () => {
    const s = store(sealed("whsec_test", "acme"));
    const res = await handle(stripeSigned("whsec_test", "{}", 1_700_000_000), ID, "", s, { key: KEY_FROM_ENV, now: () => 1_700_000_000 * 1000 });
    expect(res.status).toBe(403);
    expect(s.save).not.toHaveBeenCalled();
  });

  it("refuses when the deployment has no signing key (503, never an open relay)", async () => {
    const s = store();
    const res = await handle(stripeSigned("whsec_test", "{}", 1_700_000_000), ID, "", s, { key: null, now: () => 1_700_000_000 * 1000 });
    expect(res.status).toBe(503);
    expect(s.save).not.toHaveBeenCalled();
  });

  it("refuses when the row's ciphertext doesn't open with the deployment key", async () => {
    // Same provider, secret sealed with a different key. A Supabase row alone can't pass this check.
    const wrong = sealSecret("whsec_test", { id: KEY_ID, key: Buffer.from("22".repeat(32), "hex") });
    const row: Relay = { id: ID, user_id: "u1", name: "stripe", provider: "stripe", ...sealedToHex(wrong) };
    const s = store(row);
    const res = await handle(stripeSigned("whsec_test", "{}", 1_700_000_000), ID, "", s, { key: KEY_FROM_ENV, now: () => 1_700_000_000 * 1000 });
    expect(res.status).toBe(403);
    expect(s.save).not.toHaveBeenCalled();
  });

  it("refuses when the signature is from a different secret (401, no row)", async () => {
    const s = store(sealed("whsec_real"));
    // Sign with "wrong_secret" but the row holds whsec_real.
    const t = 1_700_000_000;
    const sig = hmacHex("wrong_secret", `${t}.{}`);
    const r = new Request(`https://weft.example/api/hooks/${ID}`, {
      method: "POST",
      headers: { "stripe-signature": `t=${t},v1=${sig}` },
      body: "{}",
    });
    const res = await handle(r, ID, "", s, { key: KEY_FROM_ENV, now: () => t * 1000 });
    expect(res.status).toBe(401);
    expect(s.save).not.toHaveBeenCalled();
  });

  it("refuses a Svix-signed request whose timestamp is outside the 5-minute window", async () => {
    const t = 1_700_000_000;
    const body = '{"type":"email.received"}';
    const id = "msg_2KxQp7abc";
    const sig = hmacSha256Hex("whsec_svix", `${id}.${t}.${body}`);
    const r = new Request(`https://weft.example/api/hooks/${ID}`, {
      method: "POST",
      headers: { "svix-id": id, "svix-timestamp": String(t), "svix-signature": `v1,${sig}`, "content-type": "application/json" },
      body,
    });
    const row = sealed("whsec_svix", "svix");
    const s = store(row);
    // Six minutes ahead; the same skew check the local route enforces after forwarding.
    const res = await handle(r, ID, "", s, { key: KEY_FROM_ENV, now: () => (t + 360) * 1000 });
    expect(res.status).toBe(401);
    expect(s.save).not.toHaveBeenCalled();
  });

  it("accepts a Svix-signed request on the near edge of the replay window", async () => {
    const t = 1_700_000_000;
    const body = '{"type":"email.received"}';
    const id = "msg_2KxQp7abc";
    const sig = hmacSha256Hex("whsec_svix", `${id}.${t}.${body}`);
    const r = new Request(`https://weft.example/api/hooks/${ID}`, {
      method: "POST",
      headers: { "svix-id": id, "svix-timestamp": String(t), "svix-signature": `v1,${sig}`, "content-type": "application/json" },
      body,
    });
    const res = await handle(r, ID, "", store(sealed("whsec_svix", "svix")), { key: KEY_FROM_ENV, now: () => (t + 299) * 1000 });
    expect(res.status).toBe(200);
  });
});

describe("restStore", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(responses: Response[]) {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(responses.shift() ?? new Response("[]")));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  const delivery = { relay_id: ID, user_id: "u1", method: "POST", path: "", headers: { a: "b" }, body: "e30=" };

  it("reads a relay with the new secret columns and a new-style secret key", async () => {
    const row = sealed("whsec_test");
    const fetch = stub([new Response(JSON.stringify([row]))]);
    expect(await restStore("https://db.example", "sb_secret_x").relay(ID)).toEqual(row);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`https://db.example/rest/v1/webhook_relays?id=eq.${ID}&select=id,user_id,name,provider,secret_ciphertext,secret_nonce,secret_key_id,tunnel_id,tunnel_path`);
    expect(init?.headers).toEqual({ apikey: "sb_secret_x", "content-type": "application/json" });
  });

  it("finds no relay, and sends a legacy key as the bearer too", async () => {
    const fetch = stub([new Response("[]")]);
    expect(await restStore("https://db.example", "eyJlegacy").relay(ID)).toBeNull();
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer eyJlegacy" });
  });

  it("saves a delivery and clears the relay's day-old ones", async () => {
    const fetch = stub([new Response("", { status: 201 }), new Response(null, { status: 204 })]);
    await restStore("https://db.example", "sb_secret_x", () => Date.UTC(2026, 9, 13)).save(delivery);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://db.example/rest/v1/webhook_deliveries");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify(delivery), headers: { prefer: "return=minimal" } });
    expect(fetch.mock.calls[1]?.[0]).toBe(`https://db.example/rest/v1/webhook_deliveries?relay_id=eq.${ID}&created_at=lt.2026-10-12T00:00:00.000Z`);
    expect(fetch.mock.calls[1]?.[1]?.method).toBe("DELETE");
  });

  it("uses the real clock by default, and throws what Supabase said", async () => {
    stub([new Response("no table", { status: 404 }), new Response("down", { status: 500 }), new Response("", { status: 201 }), new Response(null, { status: 204 })]);
    const s = restStore("https://db.example", "sb_secret_x");
    await expect(s.relay(ID)).rejects.toThrow("Supabase 404: no table");
    await expect(s.save(delivery)).rejects.toThrow("Supabase 500: down");
    await expect(s.save(delivery)).resolves.toBeUndefined();
  });
});

// The crypto round-trip the row goes through: seal on the way in, open at verify time.
describe("relay-secret end-to-end", () => {
  it("sealedToHex and sealedFromHex round-trip the bytes the relay needs to verify", () => {
    const sealed = sealSecret("whsec_test", KEY_FROM_ENV);
    const hex = sealedToHex(sealed);
    const back = sealedFromHex(hex)!;
    expect(openSecret(back, KEY_FROM_ENV)).toBe("whsec_test");
    expect(openSecret(back, null)).toBeNull();
  });
});
