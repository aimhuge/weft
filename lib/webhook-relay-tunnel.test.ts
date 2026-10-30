import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealedToHex, sealSecret, type RelayKey } from "./relay-secret";
import { FORWARD_HEADER, verifyForward } from "./tunnel-ticket";
import { handle, type DeliveryRow, type Relay, type RelayStore } from "./webhook-relay";
import { PROVIDERS } from "./webhook-signatures";

const RELAY_ID = "11111111-1111-4111-8111-111111111111";
const TUNNEL_ID = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-10-30T10:00:00Z");
const key: RelayKey = { id: "k1", key: Buffer.alloc(32, 7) };

vi.spyOn(PROVIDERS.get("github")!, "verify").mockReturnValue(true);

const relay: Relay = {
  id: RELAY_ID,
  user_id: "me",
  name: "github",
  provider: "github",
  ...sealedToHex(sealSecret("whsec", key)),
  tunnel_id: TUNNEL_ID,
  tunnel_path: "/api/hook",
};
const tunnel = { id: TUNNEL_ID, user_id: "me", public_url: "https://a.trycloudflare.com", ticket_secret: "s", expires_at: "2026-10-30T11:00:00Z" };

let saved: DeliveryRow[];
const store = (over: Partial<RelayStore> = {}): RelayStore => ({
  relay: () => Promise.resolve(relay),
  save: (d) => {
    saved.push(d);
    return Promise.resolve();
  },
  tunnel: () => Promise.resolve(tunnel),
  ...over,
});
const post = () => new Request(`https://weft.zip/api/hooks/${RELAY_ID}`, { method: "POST", body: "{}", headers: { "x-hub-signature-256": "sha256=ok" } });
const send = (s: RelayStore) => handle(post(), RELAY_ID, "?x=1", s, { key, now: () => NOW });

beforeEach(() => {
  saved = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a relay with a tunnel open", () => {
  it("hands a verified delivery straight to the route, and the provider gets its real answer", async () => {
    const reach = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{"challenge":"c"}', { status: 200, headers: { "content-type": "application/json" } })));
    vi.stubGlobal("fetch", reach);
    const res = await send(store());
    expect(await res.text()).toBe('{"challenge":"c"}');
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(saved).toEqual([]);
    const [url, init] = reach.mock.calls[0]!;
    expect(url).toBe("https://a.trycloudflare.com/api/hook?x=1");
    const ticket = (init?.headers as Record<string, string>)[FORWARD_HEADER] ?? "";
    expect(verifyForward(ticket, "s", TUNNEL_ID, "POST", "/api/hook?x=1", NOW)).toBe(true);
  });

  it("passes on the route's own failure rather than delivering twice", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("nope", { status: 400 })));
    expect((await send(store())).status).toBe(400);
    expect(saved).toEqual([]);
  });

  it("stores the delivery when the way there fails", async () => {
    for (const status of [401, 502, 530]) {
      vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status })));
      expect(await (await send(store())).text()).toBe("Relayed");
    }
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    expect(await (await send(store())).text()).toBe("Relayed");
    expect(saved).toHaveLength(4);
  });

  it("stores it when the tunnel is closed, or belongs to someone else", async () => {
    const reach = vi.fn();
    vi.stubGlobal("fetch", reach);
    await send(store({ tunnel: () => Promise.resolve({ ...tunnel, expires_at: null }) }));
    await send(store({ tunnel: () => Promise.resolve({ ...tunnel, user_id: "them" }) }));
    await send(store({ tunnel: () => Promise.resolve(null) }));
    expect(reach).not.toHaveBeenCalled();
    expect(saved).toHaveLength(3);
  });
});
