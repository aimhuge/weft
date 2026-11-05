"use client";

// A Weft Worker's own settings from Settings → Threads (components/WorkerHostSettings.tsx,
// docs/architecture/project-hosts.md#settings-on-a-worker-wp3): settings.get or settings.put as a `host` row through
// /api/worker-settings, followed to the worker's answer like a card's own action (lib/worker-acts.ts ACT_WAIT). A
// worker that doesn't answer in time is offline: that's an error here, not a queue, so the form never shows a guess.
import { gooseFieldsOf, type HostResult, type HostSettings } from "@weft/client";
import { apiFetch } from "./api-client";
import { signWiden } from "./widen-signer";
import { ACT_WAIT } from "./worker-acts";
import { waitForCommand, type CommandResult, type WaitOptions } from "./worker-command-wait";

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// A put's args: a patch that points Goose elsewhere carries this Mac's approval for exactly that patch, after Touch ID
// (lib/widen-signer.ts); the worker refuses it otherwise. Throws when there's no signer or Touch ID was refused.
async function putArgs(workerId: string, patch: Partial<HostSettings>): Promise<Record<string, unknown>> {
  const goose = gooseFieldsOf(patch);
  if (!goose) return { patch };
  return { patch, widen: await signWiden({ host: workerId, card: "", verb: "settings.put", change: { goose }, args: { patch } }) };
}

export async function workerSettings(workerId: string, patch?: Partial<HostSettings>, wait: WaitOptions = ACT_WAIT): Promise<HostSettings> {
  const body = patch ? { workerId, verb: "settings.put", args: await putArgs(workerId, patch) } : { workerId, verb: "settings.get" };
  const { commandId } = await readJson<{ commandId: string }>(
    await apiFetch("/api/worker-settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  );
  const read = async () => readJson<CommandResult>(await apiFetch(`/api/workers?command=${encodeURIComponent(commandId)}`));
  const done = await waitForCommand(read, wait);
  if (done.status === "failed") throw new Error(done.error || "Your worker couldn't do that.");
  const result = done.result as HostResult | undefined;
  if (done.status !== "done" || !result?.ok || !result.settings) throw new Error("Your worker didn't answer. It may be offline.");
  return result.settings;
}
