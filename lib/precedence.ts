import path from "node:path";
import { addClaims, claimKey, splitClaim, withoutYield } from "./claims";
import { settle } from "./runner-pending";
import { sessions } from "./runner-state";
import { canSteer, steer } from "./runner-steer";
import { getCard, updateCard } from "./store";

// Me first: a card held on a symbol claim (lib/claims.ts) can be put ahead of the card holding the code.
// The user presses Me first on the held card's prompt, or You first on the holder's thread; either way:
// - the held card takes a whole-file claim on the file and its edit goes ahead;
// - the holder yields the file to it (Card.yields): while the first card holds its claim, its edits there
//   don't ask the holder (lib/claims.ts findClash skips it), and the holder's own edits there wait on it,
//   through the same Wait as any clash (lib/permission-wait.ts), so the holder resumes once it lets go
//   (commits, or its turn ends);
// - the holder is told mid-turn (lib/runner-steer.ts), so it moves on to other work instead of finding out
//   at its next edit. A holder the board can't steer (Codex, Goose) learns at that edit, from the prompt.
// Pressing Me first on the holder's own prompt later turns it around the same way.

// What the holder is told: who goes first, on what, and what to do meanwhile.
export function yieldMessage(first: string, file: string) {
  const name = path.basename(file);
  return `Weft: the user put card ‘${first}’ first on ${name}. Leave ${name} to it for now and carry on with other work; if you need to edit ${name}, the edit is held until ‘${first}’ lets go of it.`;
}

// The user put this card's held request first: it goes ahead, and the card holding that code yields the file.
export function putFirst(cardId: string, pendingId: string) {
  const p = sessions.get(cardId)?.pending.find((x) => x.id === pendingId);
  if (!p) throw new Error("That request isn't waiting anymore.");
  const holder = p.why?.holder;
  if (!holder) throw new Error("Only an edit another card is holding can go first.");
  const { file } = splitClaim(holder.claim);
  const card = getCard(cardId);
  if (card) {
    const yields = withoutYield(card, holder.id, file);
    updateCard(cardId, { claims: addClaims(card.claims, [claimKey(file)]) ?? card.claims, yields });
  }
  const other = getCard(holder.id);
  if (other) {
    updateCard(other.id, { yields: [...withoutYield(other, cardId, file), { to: cardId, file }] });
    const session = sessions.get(other.id);
    if (canSteer(session)) steer(other.id, session, yieldMessage(card?.title ?? "another card", file));
  }
  settle(cardId, true, undefined, pendingId);
}
