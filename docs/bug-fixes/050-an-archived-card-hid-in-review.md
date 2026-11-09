# 050: An archived card hid in Review

- **Date:** 2026-10-26
- **Severity:** medium (a card that needed you vanished from the board)
- **Shipped in:** e5f0c303

## Symptom

A card moved to Done from the commit walk-through ended up in `~/.weft/board.json` with `column: "review"` and
`archived: true`. The board hides archived cards in every column (`groupCards` in `lib/board-view.ts`), so a card
that still needed you was gone.

## Root cause

`moveToDone` (`lib/pile-commit.ts`) set the card to Done and `archiveWhenIdle` (`lib/runner.ts`) archived it. The
card still had a `pending` question. Two paths send a card with a pending question back to Review:

- the session closing (`lib/runner-session.ts`: `live` is true for any card with `pending`)
- a restart (`lib/store.ts`'s loader)

Neither cleared `archived`.

## Fix

One rule in `updateCard` (`lib/store.ts`): a move to any column but Done clears `archived`, unless the same patch
sets `archived` itself (the board's own archive, which can file a card away from any column).

```ts
// before
Object.assign(card, patch, { updatedAt: now }, moved ? { columnAt: now } : {});

// after
Object.assign(card, patch, { updatedAt: now }, moved ? { columnAt: now } : {});
if (moved && card.column !== "done" && patch.archived === undefined) delete card.archived;
```

The restart loader writes cards directly, so it does the same when it sends one to Review. `archiveWhenIdle` now
sets `column: "done"` with `archived`, so it can't archive a card left in another column.

## Key rule

Archived means filed away from Done: any automatic move out of Done brings the card back.

## Files

- `lib/store.ts`
- `lib/runner.ts`
- `lib/store-archive.test.ts` (the transition), `lib/store.test.ts` (restart case)
