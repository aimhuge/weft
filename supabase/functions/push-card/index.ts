// The push-card Edge Function (docs/architecture/mobile.md#push). The cloud_cards trigger
// (supabase/migrations/20261029104224_push_devices.sql) posts { org_id, card_id, column } with the Vault secret in
// x-weft-push-secret whenever a synced card moves into needs_you or review. This checks the secret, rereads the card
// with the service role (so the body only names a card, never says what's in it), sends an Expo push to every phone
// of the card's owner, and drops the tokens Expo reports as DeviceNotRegistered. Deployed with verify_jwt off: the
// caller is the database, which has no user JWT; the secret is the check.
import { createClient } from "npm:@supabase/supabase-js@2";
import { batches, buildMessages, deadTokens, isPushColumn, type ExpoTicket, type PushCard } from "./message.ts";

const EXPO_SEND = "https://exp.host/--/api/v2/push/send";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data: ok } = await db.rpc("push_hook_ok", { p_secret: req.headers.get("x-weft-push-secret") });
  if (ok !== true) return json({ error: "Bad secret" }, 401);

  const body = (await req.json().catch(() => null)) as { org_id?: string; card_id?: string; column?: unknown } | null;
  if (!body?.org_id || !body.card_id || !isPushColumn(body.column)) return json({ error: "Bad body" }, 400);
  const column = body.column;

  const { data: row } = await db
    .from("cloud_cards")
    .select("owner_user, card, deleted")
    .eq("org_id", body.org_id)
    .eq("card_id", body.card_id)
    .maybeSingle();
  // The card may have moved on by the time this runs; a push for a column it already left would be stale.
  const card = row?.card as PushCard & { column?: string } | undefined;
  if (!row || row.deleted || !row.owner_user || !card || card.column !== column) return json({ sent: 0, skipped: "moved" });

  const [{ data: devices }, { data: org }] = await Promise.all([
    db.from("push_devices").select("expo_token").eq("user_id", row.owner_user),
    db.from("orgs").select("id, slug").eq("id", body.org_id).maybeSingle(),
  ]);
  const tokens = (devices ?? []).map((d: { expo_token: string }) => d.expo_token);
  if (!tokens.length || !org) return json({ sent: 0 });

  const messages = buildMessages({ ...card, id: body.card_id }, column, org, tokens);
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  // Optional: with Expo's enhanced push security on, every send needs the account's access token.
  const expoToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (expoToken) headers.Authorization = `Bearer ${expoToken}`;

  const dead: string[] = [];
  for (const batch of batches(messages)) {
    const res = await fetch(EXPO_SEND, { method: "POST", headers, body: JSON.stringify(batch) });
    if (!res.ok) {
      console.error("expo push failed", res.status, await res.text());
      continue;
    }
    const { data: tickets } = (await res.json()) as { data?: ExpoTicket[] };
    dead.push(...deadTokens(batch, tickets ?? []));
  }
  if (dead.length) await db.from("push_devices").delete().in("expo_token", dead);
  return json({ sent: messages.length - dead.length, dropped: dead.length });
});
