# 049: two cards waiting on each other locked the board

**Date:** 2026-10-29 · **Severity:** High (the board could not move at all — every card in the pair read "waiting", nothing was released, and no button on the card could break it)

## Symptom

Two cards that edited each other's files left the whole board stuck. Both cards sat in **Running** with the last
line **"Waiting for ‘<the other card>’"**, the board looked busy, and nothing ever moved again. The holder never
let go, because a holder only lets go when it stops being busy — and both were waiting, so both were busy. The
user could press **Wait**, **This first** or **Others first** on either card and nothing changed.

## Root cause

Since `e00b897` ("clash prompts wait by themselves"), a clash prompt doesn't park the card in **Needs you** at all.
`askUser` (`lib/runner-ask.ts`) calls `startWaiting` (`lib/permission-wait.ts`) instead, which marks the request
`waiting` and moves the card to **Running**. `checkWaits` polls every `WAIT_POLL_MS = 3000` and releases a wait when
its holder stops being busy (`releasedBecause`).

**The wait was taken on any holder, with no check on the wait graph.** A holds `f.ts`, B holds `g.ts`; B's edit of
`f.ts` waits for A, and A's edit of `g.ts` waits for B. Each wait is individually reasonable — the holder really is
busy and really does hold the code. Together they form a cycle, and the only thing that ends a wait is the holder
going idle. In a cycle nobody goes idle.

```ts
// before — lib/permission-wait.ts
export function startWaiting(cardId: string, p: Pending) {
  const holder = p.why?.holder;
  if (!holder) return;
  p.waiting = true;
  safeUpdate(cardId, { column: "running", pending: pendingView(p), lastLine: `Waiting for ‘${holder.title}’` });
}
```

**The order buttons could not break it either.** Both cards were already waiting, so **This first** and **Others
first** only re-pointed the `card.yields` — they never touched the wait. **Others first** made it worse: it added a
yield in the opposite direction, so the pair not only waited on each other but also each held the file the other
needed.

## Fix

**A wait may only be taken on a holder that is not already waiting on this card, directly or through other cards.**

**New `lib/wait-chain.ts` — the pure wait-graph logic.**

```ts
// after — lib/wait-chain.ts
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

export function wouldGridlock(targets: Map<string, string[]>, cardId: string, holderId: string) {
  if (cardId === holderId) return true;
  return waitsOn(targets, holderId, cardId);
}
```

`waitTargets` maps **waiter → the holders it waits on** — a card may hold more than one waiting request, so it
keeps an edge for each. `waitsOn` walks the chain with a `seen` set, so a graph that already contains a loop ends
the walk instead of hanging. `wouldGridlock` asks the one question that matters: would this wait close a loop? A
card waiting on itself counts too. `gridlockChain` returns the cards on the loop that would close, this card first
and the holder last.

**`lib/permission-wait.ts` — the graph is read from the live sessions, and a refused wait lets the card go ahead.**
`liveWaitTargets()` walks the `sessions` map and takes every waiting request that names a `why.holder`. `startWaiting`
is the single choke point every wait passes through — including the automatic one `askUser` starts by itself — so
the check covers the whole board, and the gridlock never needs the user to notice it.

```ts
// after — lib/permission-wait.ts
export function startWaiting(cardId: string, p: Pending) {
  const holder = p.why?.holder;
  if (!holder) return;
  if (wouldGridlock(liveWaitTargets(), cardId, holder.id)) {
    breakGridlock(cardId, p, holder);
    return;
  }
  p.waiting = true;
  safeUpdate(cardId, { column: "running", pending: pendingView(p), lastLine: `Waiting for ‘${holder.title}’` });
}
```

`breakGridlock` is the loop-breaking answer: this card takes the whole-file claim, the holder leaves the file to
it, the holder is steered mid-turn to say so, and the held edit is answered with allow. The holder was the one
waiting on this card, so it is the one that can be released — one of the two always keeps running.

```ts
// after — lib/permission-wait.ts
export function breakGridlock(cardId: string, p: Pending, holder: Holder) {
  const { file } = splitClaim(holder.claim);
  const card = getCard(cardId);
  if (card) {
    updateCard(cardId, { claims: addClaims(card.claims, [claimKey(file)]) ?? card.claims });
    const other = getCard(holder.id);
    if (other) updateCard(other.id, { yields: [...withoutYield(other, cardId, file), { to: cardId, file }] });
    const session = sessions.get(holder.id);
    if (canSteer(session)) steer(holder.id, session, gridlockMessage(card.title, file));
  }
  settle(cardId, true, undefined, p.id);
}
```

**`lib/precedence.ts` — "Others first" checks before it yields.** The button is the same wait with a different
order, so it has to refuse a loop-closing wait the same way. It checks `wouldGridlock` **before** writing the
yield, and after the call it checks `waitingOn(cardId, pendingId)`: if the wait was refused (or the holder let go
in between), it takes the yield back, so a broken gridlock doesn't leave the file pointing the wrong way.

```ts
// after — lib/precedence.ts
if (wouldGridlock(liveWaitTargets(), cardId, holder.id)) {
  // The wait would close a loop: this card goes ahead instead (lib/permission-wait.ts breakGridlock).
  waitPermission(cardId, pendingId);
  return;
}
...
waitPermission(cardId, pendingId);
if (!waitingOn(cardId, pendingId)) {
  const now = getCard(cardId);
  if (now) updateCard(cardId, { yields: withoutYield(now, holder.id, file) });
}
```

**A type for the holder.** `Holder = NonNullable<PromptReason["holder"]>` is exported from
`lib/permission-wait.ts`, because `NonNullable<Pending["why"]>["holder"]` doesn't narrow the *property* — it
stays optional under it.

## Key rule

**A wait is a claim on the holder's attention, so it may only be taken on a holder that isn't already waiting on
you — directly or through other cards.** Whenever one actor can wait on another, the graph that actor waits in has
to be checked for cycles before the wait is taken, and a cycle has to be broken by letting one of the two go
ahead, not by another wait.

## Files

- `lib/wait-chain.ts` (new) — `waitTargets`, `waitsOn`, `wouldGridlock`, `gridlockChain`: the pure wait-graph logic
- `lib/permission-wait.ts` — `liveWaitTargets`, `startWaiting`, `breakGridlock`, `gridlockMessage`, `Holder`
- `lib/precedence.ts` — `putHolderFirst` checks for a loop before yielding, and takes the yield back if the wait didn't happen
- `lib/types-card.ts` — `PromptReason.holder`, the card the wait names
- `lib/runner-state.ts` — `Pending.why` / `Pending.waiting`, the held request a wait marks
- `lib/runner-ask.ts` — `askUser`, the automatic wait that now goes through the same check
- `lib/runner-steer.ts` — `canSteer` / `steer`, how the holder is told mid-turn
- `lib/claims.ts` — `addClaims`, `claimKey`, `splitClaim`, `withoutYield`, the claims and yields the break uses
- `app/api/cards/[id]/permission/route.ts` — the `otherFirst` route that reaches `putHolderFirst`
- `components/PermissionInput.tsx`, `components/CardView.tsx` — the **This first** / **Others first** buttons
- `lib/wait-chain.test.ts` (new) — 16 tests over the pure logic: direct and two-away waits, loop-safety, self-waits, a loop through a card's second wait, the no-loop case, `gridlockChain`
- `lib/permission-wait.test.ts` — a `describe("gridlock")` block: a refused loop-closing wait (claim, yield, settle and steer message), a wait refused through other cards, a normal wait that goes through, a loop seen through a card's second wait, and a refused wait on a request queued behind the one the card is showing
