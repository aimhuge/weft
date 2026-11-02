// The review walk-through's first message, from /api/pile (lib/commit-pile.ts): what the header's "+N/-N"
// counter and the Review column's "Review all" button both start as a card. Rejects when there is nothing
// uncommitted to walk through.
import { apiFetch } from "./api-client";
import { workerPilePrompt } from "./pile-worker";
import { hostFor } from "./project-host";

export async function fetchPileReview(cwd: string) {
  // This Mac's prompt is written from its store and points at its commit script and server. A host that can't take
  // those but publishes its reads (a worker) gets one from its snapshot's pile, for a card there (lib/pile-worker.ts).
  const host = hostFor(cwd);
  if (!host.can("projectActs")) {
    const pile = host.can("reads") ? await host.read("pile", cwd) : null;
    if (!pile) throw new Error("Nothing uncommitted to walk through.");
    return workerPilePrompt(pile);
  }
  const r = await apiFetch(`/api/pile?cwd=${encodeURIComponent(cwd)}&prompt=1`);
  // A restarting dev server answers with an HTML page; treat that as no prompt rather than a SyntaxError.
  const d = (await r.json().catch(() => ({}))) as { prompt?: string; title?: string; error?: string };
  if (!d.prompt) throw new Error(d.error ?? "Nothing uncommitted to walk through.");
  return { prompt: d.prompt, title: d.title ?? "Commit the uncommitted pile" };
}

// "Review all": start the walk-through card, then open it, so it doesn't land unseen in a busy Review column.
export async function startPileReview(
  cwd: string,
  start: (cwd: string, prompt: string, title: string) => Promise<string | undefined>,
  open: (id: string) => void,
) {
  const { prompt, title } = await fetchPileReview(cwd);
  const id = await start(cwd, prompt, title);
  if (id) open(id);
}
