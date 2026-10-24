import { getCard, getThread, updateCard } from "./store";

// A card whose CLI session is gone: the CLI was told to resume a conversation it has no transcript for (deleted,
// cleaned up by Claude Code, or the card came from another Mac), so it answers "No conversation found with session
// ID" and every message after fails the same way. puku-cli also refuses one whose transcript has outgrown its cap
// ("Failed to resume session: Reconstructed transcript is too large…", on stderr only). Instead the card goes on in
// a new session started from a brief of its thread, as "Send fresh" does (lib/splice.ts), with your last message sent again.

export function isLostSessionError(text: string): boolean {
  return /no conversation found with session id|failed to resume session/i.test(text);
}

// lib/splice.ts imports lib/runner.ts, which imports the session module that calls this, so a direct import would
// be circular. This runs after a turn failed, long after lib/runner.ts has loaded, so a deferred import is fine.
async function sendFresh(cardId: string, text: string) {
  const { sendFresh } = await import("./splice");
  return sendFresh(cardId, text, { echo: false });
}

// The CLI reports the loss twice (its error result, then the SDK's exit error), so only the first, while the card
// still names the lost session, starts the new one. Returns whether it did.
export function resumeLostSession(cardId: string, lostId: string | undefined): boolean {
  const card = getCard(cardId);
  if (!lostId || card?.sessionId !== lostId) return false;
  updateCard(cardId, { sessionId: undefined, forkedFrom: undefined, lastLine: "Session gone, starting a fresh one…" });
  const last = [...getThread(cardId)].reverse().find((item) => item.kind === "user");
  if (last?.kind !== "user") return true;
  sendFresh(cardId, last.text).catch((err: unknown) => {
    updateCard(cardId, { error: err instanceof Error ? err.message : String(err) });
  });
  return true;
}
