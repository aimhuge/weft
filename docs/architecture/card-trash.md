# Recently deleted (card trash)

A deleted card used to be gone for good: `deleteCard` in `lib/store.ts` dropped it from memory, removed
`threads/<id>.json` and saved board.json. Now it waits 30 days in `~/.weft/trash/` first, and the Done column
can put it back.

## How it works

```
delete (card menu, ⌘⌫, a thread's MCP tool, host verb)
  └─ lib/store.ts deleteCard(id)
       ├─ keepDeleted(DATA_DIR, card, () => getThread(id))   lib/card-trash-file.ts
       │     writes trash/<id>.json = { card, thread, deletedAt }  (writeFileAtomic)
       │     never throws: a failure is logged and the delete goes on
       └─ removes the card, its thread file, saves board.json, publishes card_deleted

Done header 🗑  components/TrashMenu.tsx
  ├─ GET  /api/trash        → listTrash()            purges entries older than 30 days, then newest first
  └─ POST /api/trash/<id>   → restoreFromTrash(id)   addCards + replaceThread, removes the trash file
                                                      the board hears the card over the event stream
```

- **Two modules, no import cycle.** `lib/card-trash-file.ts` holds the write and the paths and never imports the
  store, so `store.ts` can call it. `lib/card-trash.ts` (list, restore, purge) imports the store.
- **A restored card is not live.** As at a restart (`loadState`): `warm` goes false, `wrappingUp` is dropped, its
  running subagents become `lost`, and a card that was running or waiting on a permission lands in Review.
- **Purge** runs on every list. An entry that won't parse is judged by its file's age, so junk doesn't stay forever.
- **Ids are checked**: one with a path separator, `.` or `..` names no trash file, so a restore can't reach outside
  `trash/`. Restoring a card already on the board is refused and leaves its entry.
- **Client**: `lib/trash-client.ts` calls through `apiFetch` (the token), and owns the `TrashItem` type so the board's
  chunk never resolves the server module.

## Limits

- An isolated card's worktree is dropped when it is deleted (`lib/host-api/card-delete.ts`); a restored isolated card
  keeps its old `worktree` field and folder, which may be gone.
- A picked-up Claude Code session stays dismissed after a restore (the sync won't bring a second copy back), which is
  what you want.
- The weft.zip web board draws the same Done header (`components/ColumnHeader.tsx`); its icon calls `/api/trash` on
  whatever server serves that board, which hasn't been checked there yet.
