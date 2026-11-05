import { SUPABASE_URL } from "@/lib/account";
import { handleAddress, restTunnel } from "@/lib/tunnel-address";
import { webClient } from "@/lib/web-session";

// A tunnel's stable address (lib/tunnel-address.ts): /t/<id>, plus any path after it. Reached from outside, so it has
// no localhost guard. The check is the visitor's own Weft session against the row's owner. GET only: webhooks come
// through their relay (lib/webhook-relay.ts), and a browser arrives by navigating.

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) return new Response("Tunnels aren't set up on this Weft.", { status: 503 });
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const at = url.pathname.indexOf(id) + id.length;
  const rest = `${url.pathname.slice(at)}${url.search}`;
  try {
    return await handleAddress(req, id, rest, {
      tunnel: restTunnel(SUPABASE_URL, key),
      userId: async () => {
        const { data } = await (await webClient()).auth.getUser();
        return data.user?.id ?? null;
      },
    });
  } catch (err) {
    console.error(`Tunnel address: ${(err as Error).message}`);
    return new Response("Couldn't reach this tunnel.", { status: 502 });
  }
}
