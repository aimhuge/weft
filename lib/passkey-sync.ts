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

// The pin last sent to each worker, for the generation it carried: while it's still on its way, it's checked again
// rather than sent again, so an offline worker doesn't collect a row per sync.
const sent = new Map<string, { commandId: string; generation: number | undefined }>();

async function settle(worker: string, pending: Refreshed, deps: PasskeySyncDeps): Promise<boolean> {
  const last = sent.get(worker);
  const commandId = last && last.generation === pending.generation ? last.commandId : await deps.post(worker, pending.endorsements);
  sent.set(worker, { commandId, generation: pending.generation });
  const done = await waitForCommand(() => deps.status(commandId), deps.wait ?? PIN_WAIT);
  // Still on its way: keep it, and ask about it next time.
  if (done.status === "pending" || done.status === "claimed") return false;
  sent.delete(worker);
  const receipt = (done.result as { value?: unknown } | null | undefined)?.value;
  return done.status === "done" && (await deps.confirm(worker, receipt));
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
