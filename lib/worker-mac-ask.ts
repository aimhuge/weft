// A worker's line to its owner's Mac for what needs a person (docs/architecture/tunnels.md#on-a-worker): a tunnel's
// Touch ID, a relay's sealed signing secret. The worker queues a device call with worker_mac_ask (the Mac it's paired
// with gets it), the Mac's inbox runs it (lib/device-call-approvals.ts) and writes its answer, and this waits for it.
// Also the key-checked writes a tunnel needs, since a worker has no session (supabase/migrations/*_worker_tunnels.sql).
import type { DeviceAnswer } from "./worker-registry";

export interface MacLink {
  ask(cardId: string, tool: string, args: unknown): Promise<string | null>;
  result(id: string): Promise<DeviceAnswer | null>;
  cancel(id: string): Promise<boolean>;
  tunnelOpen(id: string, url: string, secret: string): Promise<string | null>;
  tunnelClose(id: string): Promise<void>;
}

let link: MacLink | null = null;

// scripts/weft-worker.ts.
export function setMacLink(next: MacLink | null) {
  link = next;
}

export function macLink(): MacLink {
  if (!link) throw new Error("This worker can't reach your Mac yet. Update it with weft-worker update.");
  return link;
}

// The vault's asks go only to the Mac this worker is paired with; a tunnel or relay goes to it first and to your newest
// open Mac when it's away (worker_mac_ask, supabase/migrations/*_worker_pairing_mac.sql).
export const MAC_AWAY =
  "This needs your Touch ID on your Mac, and no Mac of yours answered. The vault answers only from the Mac this worker is paired with: open Weft there, signed in to the same account and syncing, then try again.";
// A Mac claims at once on its Realtime ping, else on its 30 s check; past that it isn't there.
export const CLAIM_MS = 45_000;
// Long enough to unlock, read the prompt and touch the sensor.
export const ANSWER_MS = 5 * 60_000;
const POLL_MS = 500;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

// A finished answer as the caller gets it: the Mac's object, or a throw with its error. Null while it isn't finished.
function settled(answer: DeviceAnswer | null): Record<string, unknown> | null {
  if (!answer) throw new Error(MAC_AWAY);
  if (answer.status === "failed") throw new Error(answer.error || "Your Mac couldn't do that.");
  if (answer.status !== "done") return null;
  return (answer.result && typeof answer.result === "object" ? answer.result : {}) as Record<string, unknown>;
}

// The Mac's answer to one ask, or a throw that says why there's none.
export async function askMac(cardId: string | undefined, tool: string, args: Record<string, unknown>, wait: (ms: number) => Promise<unknown> = sleep, now: () => number = Date.now): Promise<Record<string, unknown>> {
  if (!cardId) throw new Error("No card is bound to this thread, so there's nothing to ask your Mac for.");
  const to = macLink();
  const id = await to.ask(cardId, tool, args);
  if (!id) throw new Error(MAC_AWAY);
  const start = now();
  for (;;) {
    const answer = await to.result(id);
    const done = settled(answer);
    if (done) return done;
    if (answer?.status === "pending" && now() - start > CLAIM_MS && (await to.cancel(id))) throw new Error(MAC_AWAY);
    if (now() - start > ANSWER_MS) throw new Error("Your Mac took this and hasn't answered: the Touch ID prompt may still be open there.");
    await wait(POLL_MS);
  }
}
