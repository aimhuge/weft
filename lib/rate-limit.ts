import { recordLimit } from "./activity";
import { recordModelLimit, resetTimeOf } from "./model-limit";
import { getCard, updateCard } from "./store";
import { BACKEND_LABELS, type Backend } from "./types";
import { hitFrom } from "./usage";

// A plan-limit error parks the card in needs_you with rateLimitHit set, so the card menu and the
// rate-limit banner can offer a one-click escape to the other CLI.
// It's logged for the limit badges: the window the message names, else the one the card saw full.
//
// The hit is also recorded against the *model* that ran out (lib/model-limit.ts), because the
// limits are per model: Opus running out says nothing about Sonnet. Every thread that picks that
// model later moves to the backup model instead of waiting for the reset (lib/model-fallback.ts).
export function hitRateLimit(cardId: string, backend: Backend, message: string) {
  const card = getCard(cardId);
  if (!card) return;
  const now = Date.now();
  const hit = hitFrom(message, now);
  const named = hit && /week|session|5.hour|opus|sonnet/i.test(message);
  const kind = named ? hit.kind : (card.stats?.sevenDay?.used ?? 0) >= 100 ? "seven_day" : hit?.kind;
  if (kind) recordLimit(kind, now, card);
  // The model that ran out: the one the card was on. A card with no model of its own ran on the
  // CLI's default, which Weft doesn't name, so there's nothing to record against.
  const model = card.model;
  if (model) recordModelLimit(model, now, resetTimeOf(message, now));
  updateCard(cardId, { column: "needs_you", pending: null, error: message, rateLimitHit: true, lastLine: `${BACKEND_LABELS[backend]} hit its plan limit` });
}
