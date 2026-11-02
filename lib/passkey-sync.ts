"use client";

// Keeps each worker's trusted passkeys in step with this Mac (docs/architecture/project-hosts.md#signed-widening-as-built).
// Main remembers the set it last signed for each worker and whether the worker confirmed holding it
// (electron/widen-endorse.cjs). Until it has, this sends that set as a `pin` command and waits for the worker's
// receipt: the generation it holds, signed with the worker's pinned sign key, which main checks. A pin row a stolen
// session deletes, or one a stolen worker key claims and drops, never yields that receipt, so the revoke stays pending,
// is sent again, and Settings → Devices keeps saying the worker still trusts the passkey.
import { apiFetch } from "./api-client";
import { waitForCommand, type CommandResult, type WaitOptions } from "./worker-command-wait";
import { confirmEndorsement, refreshEndorsements, type Refreshed } from "./widen-signer";

export interface PasskeySyncDeps {
  refresh(): Promise<Refreshed[]>;
  post(worker: string, endorsements: unknown[]): Promise<string>;
  status(commandId: string): Promise<CommandResult>;
  confirm(worker: string, receipt: unknown): Promise<boolean>;
  wait?: WaitOptions;
  now?: () => number;
}

// A pin is small and the worker takes it at once when it's up; one that isn't up is asked again on the next sync.
export const PIN_WAIT: WaitOptions = { every: 2_000, unclaimed: 20_000, claimed: 30_000 };

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export const passkeySyncDeps: PasskeySyncDeps = {
  refresh: refreshEndorsements,
  post: async (worker, endorsements) =>
    (await readJson<{ commandId: string }>(await apiFetch("/api/worker-board", { method: "POST", body: JSON.stringify({ action: "pin", workerId: worker, endorsements }) }))).commandId,
  status: async (id) => readJson<CommandResult>(await apiFetch(`/api/workers?command=${encodeURIComponent(id)}`)),
  confirm: confirmEndorsement,
};

// A pin left on its way longer than this is sent afresh: a row a stolen worker key claims and never reports on, or one
// set back to claimed, mustn't hold the revoke up. A second row for the same set is harmless: the worker holds it.
export const PIN_STALE_MS = 60_000;

// The pin last sent to each worker, for the generation it carried and when: while it's still on its way and fresh, the
// next sync reads it once instead of sending another, so an offline worker doesn't collect a row per sync.
const sent = new Map<string, { commandId: string; generation: number | undefined; at: number }>();

// What came of a pin: its receipt checked by main (true), still on its way (null), or nothing (false: send again).
async function outcome(worker: string, done: CommandResult, deps: PasskeySyncDeps): Promise<boolean | null> {
  if (done.status === "pending" || done.status === "claimed") return null;
  sent.delete(worker);
  const receipt = (done.result as { value?: unknown } | null | undefined)?.value;
  return done.status === "done" && (await deps.confirm(worker, receipt));
}

async function settle(worker: string, pending: Refreshed, deps: PasskeySyncDeps): Promise<boolean> {
  const now = (deps.now ?? Date.now)();
  const last = sent.get(worker);
  if (last && last.generation === pending.generation && now - last.at <= PIN_STALE_MS) {
    // One read: a row that's gone (deleted by a stolen session) or can't be read is sent again, below.
    const read = await deps.status(last.commandId).catch(() => null);
    const came = read ? await outcome(worker, read, deps) : false;
    if (came !== false) return came === true;
  }
  const commandId = await deps.post(worker, pending.endorsements);
  sent.set(worker, { commandId, generation: pending.generation, at: now });
  return (await outcome(worker, await waitForCommand(() => deps.status(commandId), deps.wait ?? PIN_WAIT), deps)) === true;
}

// The workers that don't hold this Mac's latest set for them yet. Each is tried; one that fails stays listed.
export async function syncPasskeys(deps: PasskeySyncDeps = passkeySyncDeps): Promise<string[]> {
  const untaken: string[] = [];
  for (const pending of await deps.refresh()) {
    const ok = await settle(pending.worker, pending, deps).catch(() => false);
    if (!ok) untaken.push(pending.worker);
  }
  return untaken;
}

export const forgetSentPins = () => sent.clear();
