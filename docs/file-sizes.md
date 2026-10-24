# File sizes

Lines per source file (app, lib, components, electron, scripts, docs, and the config files).
Snapshot: 2026-10-24

| Lines | Files |
|---|---|
| <=50 | 427 |
| 51-150 | 582 |
| 151-300 | 220 |
| 301-500 | 28 |
| 501-1000 | 4 |
| 1001-2000 | 1 |
| 2000+ | 0 |

Total files: 1262. Over 500 lines: 5.

## Largest files

| Lines | File |
|---|---|
| 1072 | README.md |
| 937 | docs/FAQ.md |
| 821 | docs/architecture/teams-vault.md |
| 669 | CHANGELOG.md |
| 625 | docs/architecture/threads-and-sessions.md |
| 482 | docs/architecture/mini-app-hosting.md |
| 481 | electron/main.cjs |
| 479 | components/Board.tsx |
| 461 | docs/architecture/MAP.md |
| 433 | lib/settings.ts |
| 429 | docs/ROADMAP.md |
| 409 | docs/architecture/goose.md |
| 387 | electron/vault.cjs |
| 382 | electron/browser-pane.cjs |
| 366 | components/ReplyBox.tsx |
| 357 | lib/goose-runner.ts |
| 347 | lib/runner-turn.ts |
| 346 | docs/architecture/billing.md |
| 340 | lib/runner.harness.ts |
| 335 | docs/architecture/desktop-shell.md |

## Delta from 2026-10-10

| Bucket | 2026-10-10 | 2026-10-24 | Change |
|---|---|---|---|
| <=50 | 4 | 427 | +423 |
| 51-150 | 7 | 582 | +575 |
| 151-300 | 3 | 220 | +217 |
| 301-500 | 0 | 28 | +28 |
| 501-1000 | 0 | 4 | +4 |
| 1001-2000 | 0 | 1 | +1 |
| 2000+ | 0 | 0 | 0 |
| **Total** | **14** | **1262** | **+1248** |

Largest-files changes:

- `README.md`: 153 → 1072 lines (+919)
- `docs/ROADMAP.md`: 288 → 429 lines (+141)
- `docs/architecture/desktop-shell.md`: 259 → 335 lines (+76)
- `docs/architecture/threads.md`: 225 → renamed/restructured as
  `docs/architecture/threads-and-sessions.md` (625 lines)
- `docs/architecture/board.md`: 218 → not in the top 20 (moved/split out)
- `docs/architecture/import.md`: 213 → not in the top 20 (moved/split out)
- `docs/architecture/copilot.md`: 190 → not in the top 20 (moved/split out)
- `docs/architecture/browser-pane.md`: 160 → not in the top 20 (moved/split out)
- `docs/architecture/skills.md`: 152 → not in the top 20 (moved/split out)
- `docs/architecture/runner.md`: 137 → not in the top 20 (moved/split out)
- `docs/architecture/permissions.md`: 104 → not in the top 20 (moved/split out)
- `docs/architecture/index.md`: 88 → not in the top 20 (moved/split out)
- `docs/architecture/show-rail.md`: 63 → not in the top 20 (moved/split out)

New entries not present in the 2026-10-10 snapshot:

- `docs/FAQ.md` (937), `docs/architecture/teams-vault.md` (821),
  `CHANGELOG.md` (669), `docs/architecture/mini-app-hosting.md` (482),
  `electron/main.cjs` (481), `components/Board.tsx` (479),
  `docs/architecture/MAP.md` (461), `lib/settings.ts` (433),
  `docs/architecture/goose.md` (409), `electron/vault.cjs` (387),
  `electron/browser-pane.cjs` (382), `components/ReplyBox.tsx` (366),
  `lib/goose-runner.ts` (357), `lib/runner-turn.ts` (347),
  `docs/architecture/billing.md` (346), `lib/runner.harness.ts` (340)

Notes:

- The 2026-10-10 snapshot was taken when `app/`, `lib/`, `components/`,
  `electron/`, and `scripts/` were not yet present in the working tree, so it
  only saw `docs/` plus `README.md` (14 files total). This scan covers the full
  tree, which is why every bucket grew and the totals are not directly
  comparable as a like-for-like change.
- The previous snapshot's own note ("The earlier-today snapshot only saw the
  `docs/` tree (plus README.md)") confirms the scope gap.
- `docs/file-sizes.md` itself was 48 lines in the previous snapshot and is
  not counted in the current top-20 list.
- Regenerate with `.claude/skills/done/file-sizes.sh`.
