// The ICE servers a session line uses (docs/architecture/project-hosts.md#routes-the-webrtc-line): Cloudflare's STUN
// always, and its TURN relay when this server holds a TURN key, for networks that block a direct connection. TURN
// credentials are minted here, short-lived, and never stored: the board asks app/api/rtc-ice, puts what it gets in the
// offer it seals to the worker, and both ends relay through the same allocation. The key itself stays in this process.
import { iceServers, type IceServer } from "./host-line-protocol";
import { STUN } from "./rtc-signal";

export const TURN_ENV = { keyId: "CLOUDFLARE_TURN_KEY_ID", token: "CLOUDFLARE_TURN_KEY_API_TOKEN" } as const;
// Long enough for a working session; a line that outlives it reconnects with fresh ones.
export const TURN_TTL_S = 4 * 60 * 60;
export const STUN_ONLY: IceServer[] = [{ urls: STUN }];

const endpoint = (keyId: string) => `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`;

// Browsers refuse port 53, so Cloudflare's own docs drop those addresses; the rest are the same servers.
const usable = (url: string) => !/:53(\?|$)/.test(url);

// Cloudflare's answer: `{ iceServers: [...] }`, or the older `{ iceServers: { urls, username, credential } }`.
export function iceFromCloudflare(body: unknown): IceServer[] {
  const raw = (body as { iceServers?: unknown } | null)?.iceServers;
  const list = iceServers(Array.isArray(raw) ? raw : [raw]);
  return list.flatMap((server) => {
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(usable);
    return urls.length ? [{ ...server, urls }] : [];
  });
}

type Fetch = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

let cached: { servers: IceServer[]; until: number } | null = null;

export const forgetIce = () => void (cached = null);

// STUN alone without a key, or when Cloudflare can't be reached: a line still forms wherever a direct route exists.
// Minted servers are reused for half their life, so a board reconnecting doesn't mint every time.
export async function mintIce(env: Record<string, string | undefined> = process.env, fetcher: Fetch = fetch, now = Date.now()): Promise<{ iceServers: IceServer[]; turn: boolean }> {
  const keyId = env[TURN_ENV.keyId];
  const token = env[TURN_ENV.token];
  if (!keyId || !token) return { iceServers: STUN_ONLY, turn: false };
  if (cached && cached.until > now) return { iceServers: cached.servers, turn: true };
  try {
    const res = await fetcher(endpoint(keyId), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ ttl: TURN_TTL_S }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const servers = iceFromCloudflare(await res.json());
    if (!servers.some((s) => [s.urls].flat().some((u) => u.startsWith("turn")))) throw new Error("no TURN servers");
    cached = { servers, until: now + (TURN_TTL_S * 1000) / 2 };
    return { iceServers: servers, turn: true };
  } catch {
    return { iceServers: STUN_ONLY, turn: false };
  }
}
