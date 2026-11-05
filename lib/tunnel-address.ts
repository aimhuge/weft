import { enterTicket } from "./tunnel-ticket";

// A tunnel's stable address on the deployed Weft, /t/<id> (docs/architecture/tunnels.md). A quick tunnel's URL changes
// on every start, so Weft keeps the current one on a Supabase row and this looks it up. Private by design: only the
// owner gets through, and they get a short ticket the Mac's gate (lib/tunnel-gate.ts) will honour. Anyone else sees
// the same 404 as an id that doesn't exist, so an address doesn't confirm that a tunnel is there.

export interface TunnelRow {
  id: string;
  user_id: string;
  public_url: string | null;
  ticket_secret: string | null;
  expires_at: string | null;
}

export interface AddressDeps {
  tunnel: (id: string) => Promise<TunnelRow | null>;
  userId: () => Promise<string | null>;
  now?: () => number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain", "cache-control": "no-store" } });
const go = (location: string) => new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });

export type OpenRow = TunnelRow & { public_url: string; ticket_secret: string; expires_at: string };

export function isOpen(row: TunnelRow, now: number): row is OpenRow {
  return Boolean(row.public_url && row.ticket_secret && row.expires_at && Date.parse(row.expires_at) > now);
}

export async function handleAddress(req: Request, id: string, rest: string, deps: AddressDeps): Promise<Response> {
  if (!UUID.test(id)) return text("Not found", 404);
  const self = new URL(req.url);
  const user = await deps.userId();
  if (!user) return go(`/login?next=${encodeURIComponent(`${self.pathname}${self.search}`)}`);
  const row = await deps.tunnel(id);
  if (!row || row.user_id !== user) return text("Not found", 404);
  const now = (deps.now ?? Date.now)();
  if (!isOpen(row, now)) return text("This tunnel is closed. Open it again from 🪝 in Weft.", 503);
  const ticket = enterTicket(row.ticket_secret, row.id, now);
  return go(`${row.public_url}/__weft/enter?ticket=${ticket}&next=${encodeURIComponent(rest || "/")}`);
}

// The row through Supabase's REST API with the secret key, the only reader of ticket_secret.
export function restTunnel(url: string, key: string) {
  const headers: Record<string, string> = { apikey: key };
  if (!key.startsWith("sb_")) headers.authorization = `Bearer ${key}`;
  return async (id: string): Promise<TunnelRow | null> => {
    const res = await fetch(`${url}/rest/v1/tunnels?id=eq.${id}&select=id,user_id,public_url,ticket_secret,expires_at`, { headers });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    return ((await res.json()) as TunnelRow[])[0] ?? null;
  };
}
