# Star and tags

Status: built 2026-10-12. They replace the library (↻ recipes, ☑ to-dos, ✎ notes), which filed starred cards
in their own store. Now a card is just starred, tagged, or both, and the board itself is where you find it.

## ★ Star

- A plain toggle: ☆ on a card while you hover it and in an open thread's header (`components/StarButton.tsx`),
  or Star / Unstar in the card menu (`K`). Starred, it's a ★ that stays visible.
- A starred card is never auto-archived: `archiveWhenIdle` and the Done automations in `lib/runner.ts` skip it.
- The rail's ★ filters the board to starred cards. Drop a card on it to star it.

## Tags

A card has `tags` and `tagsBy` (`"user"` or `"auto"`, in `lib/types.ts`). Tags follow GitHub's label rules, so a
card's tags and its issue's labels map 1:1:

- lowercase, single spaces, a leading `#` dropped (`normalizeTag` in `lib/tags.ts`)
- up to 50 characters each, unique ignoring case
- up to 8 per card

### The catalog

`~/.weft/tags.json` holds the tags themselves, like a repo's labels page: a name, a colour (`#rrggbb`) and a
description (up to 100 characters). A tag can sit in the catalog before any card carries it. The cards are the
truth for which card carries what, so a tag only on cards still lists. With no colour, a tag is drawn in its steady
hue (`tagHue`).

## Pieces

- `lib/tags.ts` (pure): the rules, `normalizeTag`, `normalizeTags`, `tagCounts`, `tagHue`.
- `lib/tag-store.ts` (server): the catalog. `listTags` (with counts, archived cards too), `createTag`, `updateTag`
  (a rename rewrites every card), `deleteTag` (takes the tag off every card) and `rememberTags`. Card changes go
  through `updateCard`, so the board reloads them.
- `app/api/tags`: GET lists with counts, POST creates, PATCH renames, recolours or describes, DELETE removes.
- `PATCH /api/cards/[id]` with `{tags}` or `{starred}` sets a card's tags or star (client: `api.mark`).
- `lib/rail-view.ts` (pure): how the rail reads. The ★ and tag filter (`filterCards`, `toggleTag`), tag
  suggestions, colours and the palette, the two pills on a card (`cardTags`), and the pinned preference.
- `components/LibraryRail.tsx` (`SideRail`): the 38px rail left of the columns. ★ and 🏷 at the top (the two
  board-only buttons live in `components/RailBoardButtons.tsx`, shared with weft.zip's rail); the 🔐 vault,
  ▲ Vercel, Supabase and BlastCP drawers under them, unchanged. While a card is dragged, ★ and 🏷 light up as drop
  targets.
- `lib/use-drawer-width.ts`: every rail drawer's width. The board sheet's left edge over an open drawer is a handle:
  drag it between 220 and 640px (always leaving 360px of window for the board), double-click for the default 272px.
  The width sits in localStorage `weft.railDrawerWidth` and reaches `components/rail-drawer.css` as `--rail-drawer-w`,
  so the slide-out animation follows it.
- `components/TagsDrawer.tsx`: the 🏷 drawer, like GitHub's labels page. New tag with a colour, rename (double-click
  or ✎), recolour, delete with a confirm that says how many cards carry it, click a tag to filter the board, drop a
  card on a tag to add it. ⌘L opens it.
- `components/TagsDialog.tsx`: a card's tags as chips with autocomplete, saved as you go. "Tags…" in the card
  menu (`G`), or click the tags in the thread header.
- `components/CardMarks.tsx`: up to two tag pills and "+N", at the end of the card's existing stage line, so no new
  row. Click a pill to filter the board. A card from a GitHub issue shows "#N", linked to the issue.
- Copilot (`lib/board-tools.ts`): `set_tags`, `tags` on `create_card`, and `list_cards` shows ★ and tags.

## Auto tags

The retitle step after each turn (`retitleAfterTurn` in `lib/show.ts`, rules and prompts in `lib/retitle.ts`)
makes one Haiku call that returns the title, the tags, or both, whichever the card needs (`nameNeeds`).

- It tags a card only when it has no tags and you haven't set (or cleared) them yourself: `shouldTag` skips
  `tagsBy: "user"`. Its tags are saved with `tagsBy: "auto"`.
- It asks for 1 to 3 short tags and reuses the board's vocabulary (`tagVocabulary`): the catalog's names first, then
  the cards' tags, most used first. A new tag only when none fits.

On 2026-10-12 every existing card (about 796) was tagged once from a 25-tag vocabulary: feature, ui, bug, decks,
question, ai, chore, content, publishing, research, personal, integrations, infra, setup, design, finance,
security, release, refactor, analytics, keyboard, music, tests, perf, docs.

## Migration from the library

On load, `lib/store.ts` (`migrateLibrary`) turns a card with the old `libraryId` into a starred card with a
`recipe`, `to-do` or `note` tag, read from the library's `items.json` indexes. It drops `libraryId` and `recipeId`
and saves the board once. The files in `~/.weft/library` and the recipe skills in `~/.claude/skills` stay on disk;
a recipe still runs as a Claude Code skill.

## Not yet

- A card's tags don't flow back to its GitHub issue's labels. Issues feed cards one way for now
  (docs/architecture/github-issues.md).
- No filter by more than one tag at a time.
- The recipe, to-do and note pages the library kept aren't reachable from the board anymore.

## Filtering by tag

Two paths narrow the board to a tag, and they coexist:

- The rail's ★/tag chip (the `RailFilterChip` next to the filter box) is a sticky filter: ★ and a
  tag together are an `AND`. It uses `lib/rail-view.ts` `filterCards`, the same picker the 🏷
  drawer toggles.
- The `/`-focused filter input (`components/FilterBox.tsx`) is the ad-hoc one. Its query is parsed
  by `queryShape` in `lib/board-view.ts`:
  - `tag:foo` (case-insensitive, optional space after the colon) narrows to that tag alone. The
    card must carry it.
  - Otherwise the query is a free-text needle, matched against `title | prompt | lastLine |
    stage | remaining | tags` (case-insensitive). Typing `bug` lands on cards tagged `bug` *and*
    on cards whose title or prompt contains "bug".
  `groupByColumn` runs the same rules. `topMatches(groups, limit, query)` returns
  `FilterMatch = { card, matchedTag? }`; the dropdown renders a `TagPill` next to the title when
  `matchedTag` is set, so the cause of the match is visible.
