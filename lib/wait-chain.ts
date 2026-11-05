// The wait graph: which card waits on which.
//
// Why it exists: two cards can wait on each other. A holds f.ts, B holds g.ts; B's edit of f.ts waits
// for A, and A's edit of g.ts waits for B. Neither is ever released — releasedBecause (lib/permission-wait.ts)
// only frees a wait when the holder stops being busy, and both stay busy forever. That is gridlock, and
// no button on the card can break it: both cards are already waiting, so the order buttons only re-point
// the yields.
//
// The rule that prevents it: a card may only wait on a holder that is not already waiting on it, directly
// or through other cards. When the chain from the holder leads back to this card, the loop would close, so
// the wait is refused and this card goes ahead instead (lib/permission-wait.ts breakGridlock).
//
// A card can hold more than one waiting request — two edits of two files, each waiting on a different
// holder — so the graph keeps every edge, not one per card: a loop through a card's second wait is a loop
// just as much as one through its first.

// The card each waiting card waits on, by card id. A card waits when one of its held requests is marked
// waiting and names the holder it waits for. A card with several waiting requests keeps an entry for
// each holder it waits on.
export function waitTargets(waiting: Iterable<{ id: string; holderId: string }>) {
  const targets = new Map<string, string[]>();
  for (const w of waiting) {
    const held = targets.get(w.id);
    if (held) {
      if (!held.includes(w.holderId)) held.push(w.holderId);
    } else {
      targets.set(w.id, [w.holderId]);
    }
  }
  return targets;
}

// Whether `from` waits on `to`, directly or through other cards. Walks the chain with a seen set, so a
// graph that already contains a loop ends the walk instead of hanging.
export function waitsOn(targets: Map<string, string[]>, from: string, to: string) {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length) {
    const at = queue.shift();
    if (!at || seen.has(at)) continue;
    if (at === to) return true;
    seen.add(at);
    for (const next of targets.get(at) ?? []) queue.push(next);
  }
  return false;
}

// Whether adding a wait from `cardId` on `holderId` would close a loop: the holder already waits on this
// card, directly or through other cards. A self-wait counts — a card waiting on itself is gridlock too.
export function wouldGridlock(targets: Map<string, string[]>, cardId: string, holderId: string) {
  if (cardId === holderId) return true;
  return waitsOn(targets, holderId, cardId);
}

// The cards on the chain from the holder back to this card: the loop that would close. Empty when there
// is none. The first is this card, the last is the holder — the order the wait would run in.
export function gridlockChain(targets: Map<string, string[]>, cardId: string, holderId: string) {
  if (cardId === holderId) return [cardId];
  const chain: string[] = [];
  const seen = new Set<string>();
  let at: string | undefined = holderId;
  while (at && !seen.has(at)) {
    chain.push(at);
    if (at === cardId) return chain.reverse();
    seen.add(at);
    at = targets.get(at)?.[0];
  }
  return [];
}
