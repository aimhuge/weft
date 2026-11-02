import { accountClient } from "./account";
import { shell } from "./browser-shell";
import { NO_TOUCH_ID, type TunnelHost, type TunnelRecord } from "./tunnel-host";
import { listWebhooks } from "./webhooks";

// The Mac's tunnel host (docs/architecture/tunnels.md): Touch ID through Electron main, and the `tunnels` row written as
// the signed-in owner, whose grants skip reading ticket_secret back.

async function publishRow(id: string, fields: { public_url: string | null; ticket_secret: string | null; expires_at: string | null }) {
  const { error } = await accountClient()
    .from("tunnels")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// A plain insert: an upsert would also update id, which the table's grants leave out.
async function ensureRow(record: TunnelRecord) {
  const { data, error: readError } = await accountClient().from("tunnels").select("id").eq("id", record.id).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (data) return;
  const { error } = await accountClient().from("tunnels").insert({ id: record.id, name: record.name });
  if (error) throw new Error(error.message);
}

export const macTunnels: TunnelHost = {
  async ready() {
    const { data } = await accountClient().auth.getSession();
    if (!data.session) throw new Error("Sign in to your Weft account first: a tunnel's address only lets you in.");
  },
  weftPort: () => Number(process.env.PORT) || undefined,
  async approve(record, hours) {
    const { approved } = (await shell("/tunnels/approve", { folder: record.folder, target: record.target, hours })) as { approved?: boolean };
    if (!approved) throw new Error(NO_TOUCH_ID);
    await ensureRow(record);
    return {};
  },
  publish: (id, open) => publishRow(id, { public_url: open.url, ticket_secret: open.secret, expires_at: new Date(open.expiresAt).toISOString() }),
  unpublish: (id) => publishRow(id, { public_url: null, ticket_secret: null, expires_at: null }),
  async linkRelays(target, tunnelId) {
    const origin = new URL(target).origin;
    for (const hook of listWebhooks()) {
      if (!hook.relayId || new URL(hook.target).origin !== origin) continue;
      const tunnel_path = tunnelId ? new URL(hook.target).pathname : null;
      const { error } = await accountClient().from("webhook_relays").update({ tunnel_id: tunnelId, tunnel_path }).eq("id", hook.relayId);
      if (error) console.warn(`Tunnel: couldn't link ${hook.name}: ${error.message}`);
    }
  },
};
