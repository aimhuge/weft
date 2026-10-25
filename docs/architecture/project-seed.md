# Starter Backlog for a new project

Status: built 2026-10-25.

The first time a project folder lands on the board, Weft parks a few cards in its Backlog from what it can already
see. None of them start; they wait for you. It happens in the background, once per project, and at most 6 cards.
**Re-seed Backlog** in the project menu (the More dropdown on the project bar, under Changelog) runs it again for the
selected project; it skips cards already on the board and says how many it added.

## What becomes a card, in this order

1. **Set up for agents**: no CLAUDE.md or AGENTS.md. The card runs `/init`, then `/weft:setup-done`.
2. **Migrate <project>'s Supabase**: local `supabase/migrations` the linked project hasn't applied, read from the
   control server's `/supabase/status` (the same read the ⚡ Supabase rail badge counts). The prompt is the drawer's
   Migrate prompt (`lib/supabase-migrate.ts`): review first, apply only on your OK.
3. **GitHub issues**: up to 3 open issues assigned to you (`--assignee @me`) or labeled `bug`, newest first. They
   become cards through `applyIssues` in `lib/github-issues.ts`, so they look like synced issue cards ("#N", labels as
   tags) and a later issue sync won't import them twice.
4. **Production-ready checks**: up to 2 failing checks from `lib/project-checks.ts`, most important first (secrets
   ignored, pushed, lockfile, guarded, coverage, README, …), each with its own "Set it up" prompt
   (`setupPrompt`, `lib/project-badges.ts`). Agent docs are left out because card 1 covers them.
5. **Clear the TODOs in <file>**: the file with the most TODO/FIXME comments (`git grep`, no Markdown or lockfiles),
   if it has at least 4. At most one card.

A card already on the board for the project (same title, or the same issue) isn't added again. A source that can't
be asked (no `gh`, no Supabase link, not a git repo) adds nothing.

## When it runs

- `lib/project-open.ts` is the shared project-open hook. `touchProject` (`lib/settings.ts`) calls `projectOpened`
  when a folder is new to the recent projects: opened from the menu, cloned, made new, or the folder of a new card.
  Handlers register by name (`onProjectOpen`) and run on a later tick, never inline, because `touchProject` is on the
  start-a-card path. The Vercel env diff uses it too (`lib/vercel-drift-open.ts`).
- `startProjectSeed()` (from `prewarm()`) registers the seeder. It waits 5s after a project opens, so a card started
  there gets its CLI first.
- `~/.weft/project-seeds.json` is the list of seeded folders. When the file doesn't exist yet, every project already
  on the board goes in as seeded, so turning this on doesn't flood an existing board.

## Copilot chips

`SEED_SOURCE` in `lib/copilot-setup.ts` gives the copilot's chips one line per starter card a project would get now,
minus what's on the board (`seedChipLines`, cached 10 minutes), so a chip can offer one.

## Pieces

- `lib/project-seed.ts`: pure. Builds the seeds, `pickSeeds` (order, dedupe, cap), `seedLine` for chips.
- `lib/project-seed-find.ts`: does the looking (`findSeeds`).
- `lib/project-seed-run.ts`: `seedProject(folder, {force})`, the seeded list, `startProjectSeed`, `seedChipLines`.
- `app/api/projects/seed` (POST `{path}`), `api.seedProject` in `lib/client-api.ts`, the menu item in
  `components/ProjectMenu.tsx` (the button is `components/ReseedButton.tsx`, which shows "Added N cards" or "Nothing new" in its own label).
