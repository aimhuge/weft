import { shell } from "./browser-tools";
import { insertRelay, isSealed, NO_TOUCH_ID, noValue, refreshWebhookRelay, relayable, relaySignedIn, requireHook, SIGN_IN, type Sealed } from "./webhook-forward";
import type { Webhook } from "./webhooks";

// Several webhooks' relays at once (mcp__webhooks__relay with names, docs/architecture/webhooks.md): one Touch ID per
// project folder for every secret it seals, not one per webhook. Each webhook is checked like createRelay's; one
// that can't get a relay (no provider, no secret, a blank secret, gone) comes back with why, and the rest still go.

export type RelayResult = { id: string; hook: Webhook; error?: undefined } | { id: string; hook?: undefined; error: string };

type Pending = { hook: Webhook; provider: string; secret: string };
type Listed = { name: string; environment: string; missing: boolean };

const message = (err: unknown) => (err as Error).message;

// Names with a value in the folder's development vault, so a blank one is reported before the Touch ID instead of
// sinking the whole batch (main seals nothing when a name is missing).
async function filledNames(folder: string): Promise<Set<string>> {
  const r = (await shell("/secrets/list", { folder })) as { secrets?: Listed[] };
  return new Set((r.secrets ?? []).filter((s) => s.environment === "development" && !s.missing).map((s) => s.name));
}

// One folder's pending webhooks: their secrets sealed under one approval, then a relay row each.
async function sealFolder(folder: string, pending: Pending[]): Promise<RelayResult[]> {
  const filled = await filledNames(folder);
  const blank = pending.filter((p) => !filled.has(p.secret));
  const ready = pending.filter((p) => filled.has(p.secret));
  const out: RelayResult[] = blank.map((p) => ({ id: p.hook.id, error: noValue(p.secret) }));
  if (!ready.length) return out;
  const r = (await shell("/webhooks/relay-seal-many", {
    folder,
    environment: "development",
    hooks: ready.map((p) => ({ name: p.secret, provider: p.provider })),
  })) as { denied?: boolean; missing?: string[]; sealed?: Record<string, Sealed> };
  for (const p of ready) {
    const trio = r.sealed?.[p.secret];
    if (r.denied) out.push({ id: p.hook.id, error: NO_TOUCH_ID });
    else if (!isSealed(trio)) out.push({ id: p.hook.id, error: noValue(p.secret) });
    else out.push(await insertRelay(p.hook, p.provider, trio).then((hook) => ({ id: hook.id, hook }), (err: unknown) => ({ id: p.hook.id, error: message(err) })));
  }
  return out;
}

// Results in the order of ids. A webhook that already has a relay is returned as it is, with no Touch ID.
export async function createRelays(ids: string[]): Promise<RelayResult[]> {
  if (!(await relaySignedIn())) throw new Error(SIGN_IN);
  const results = new Map<string, RelayResult>();
  const byFolder = new Map<string, Pending[]>();
  for (const id of ids) {
    try {
      const hook = requireHook(id);
      if (hook.relayId) results.set(id, { id, hook });
      else byFolder.set(hook.folder, [...(byFolder.get(hook.folder) ?? []), { hook, ...relayable(hook) }]);
    } catch (err) {
      results.set(id, { id, error: message(err) });
    }
  }
  for (const [folder, pending] of byFolder) for (const r of await sealFolder(folder, pending)) results.set(r.id, r);
  if (byFolder.size) await refreshWebhookRelay();
  return ids.map((id) => results.get(id) ?? { id, error: "That webhook is gone." });
}
