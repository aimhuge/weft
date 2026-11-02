// "Switch all to <other CLI>" over the cards in a column, wherever each runs: this Mac's go to the bulk route (which
// leaves a busy card `pending` for the button to retry); a worker's go one by one as card.switchBackend on its host
// (lib/project-host.ts), replaying a rate-limited card's last message as the route does. A worker card still running
// can't be switched mid-turn, so it says so rather than wait on a retry only this Mac's route can answer.
import { api } from "./client";
import { hostOf } from "./project-host";
import type { Backend, Card } from "./types";
import { isWorkerCard } from "./worker-project";

export type SwitchResult = { switched: string[]; failed: { id: string; error: string }[]; pending: string[] };

const NONE: SwitchResult = { switched: [], failed: [], pending: [] };
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

type Switchable = Pick<Card, "id" | "cwd" | "column" | "rateLimitHit">;

async function onWorker(card: Switchable, backend: Backend): Promise<{ id: string; error?: string }> {
  if (card.column === "running") return { id: card.id, error: "still running on its worker; switch it once its turn ends" };
  try {
    await hostOf(card).act("card.switchBackend", { id: card.id, backend, replay: Boolean(card.rateLimitHit) });
    return { id: card.id };
  } catch (err) {
    return { id: card.id, error: errorText(err) };
  }
}

export async function switchCards(cards: readonly Switchable[], backend: Backend): Promise<SwitchResult> {
  const local = cards.filter((c) => !isWorkerCard(c)).map((c) => c.id);
  const [mine, theirs] = await Promise.all([
    local.length ? api.switchBackends(local, backend) : NONE,
    Promise.all(cards.filter(isWorkerCard).map((c) => onWorker(c, backend))),
  ]);
  return {
    switched: [...mine.switched, ...theirs.flatMap((r) => (r.error ? [] : [r.id]))],
    failed: [...mine.failed, ...theirs.flatMap((r) => (r.error ? [{ id: r.id, error: r.error }] : []))],
    pending: mine.pending,
  };
}
