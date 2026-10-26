# Supabase

Status: linking built 2026-10-12, and making a project in place the same day. The Migrate card 2026-10-13. Types, keys into the 🔐 vault and agent tools are next.

Supabase's green bolt on the left rail (under ▲, in `components/LibraryRail.tsx`) opens a drawer that links each
board project to a Supabase project, the same way ▲ links one to Vercel (docs/architecture/vercel.md).

## The token

- You paste a personal access token (`sbp_…`) from supabase.com/dashboard/account/tokens into the drawer. Main checks
  it (`GET /v1/organizations`, which also names the orgs shown under the header) before keeping it.
- Main seals it with Electron's `safeStorage` (Keychain) in `~/.weft/supabase-token.json` (mode 0600), and refuses
  without safeStorage rather than writing it in the clear.
- The token never leaves main: every Management API call (`api.supabase.com/v1`) is made there, and the board gets
  back names, refs, regions and states. `lib/secret-guard.ts` denies threads `supabase-token.json`.
- Weft doesn't read the Supabase CLI's own login (`~/.supabase/access-token` or the Keychain entry it makes).

## The link

A link is `supabase/.temp/project-ref`, the file `supabase link` writes, plus `.temp` in the `.gitignore` of the project's `supabase/` folder (as
`supabase init` does). No Weft-side state: the Supabase CLI in a thread (`supabase db push`, `supabase gen types
--linked`, `supabase migration list`) works on the right project with no prompt, and a folder linked by the CLI shows
up linked in the drawer.

- A folder whose `.mcp.json` points the Supabase MCP server (`https://mcp.supabase.com/mcp?project_ref=…`) at a
  project counts as linked too ("Linked in .mcp.json"). The drawer won't change that checked-in file: its button
  is **Link CLI…**, which writes the CLI's file as well.
- **Link…** lists every project the token reaches; `pickerList` in `lib/supabase-view.ts` puts best fits first (the
  repo's or folder's name 2, a name containing it 1), then newest. Supabase projects have no git link to match on.
- **+ New project** (`components/SupabaseNewProject.tsx`) makes one in place: a name (the repo's, else the folder's,
  `defaultProjectName`), the organization when the token reaches more than one, and a region (where most of your
  projects are, else East US, `defaultRegion`). Main (`create`) makes a 32-character database password, sends
  `POST /v1/projects` with `region_selection`, links the folder, and keeps the password in the folder's 🔐 vault as
  `SUPABASE_DB_PASSWORD` (development), the variable the Supabase CLI reads. A vault already holding one (another
  project's) gets `SUPABASE_DB_PASSWORD_<NAME>` instead. The password never reaches the board; if the vault can't keep
  it, the project is still made and linked and the error says to reset it in the dashboard. The project is "Starting"
  for a minute or two. **supabase.com ↗** in the form still opens the dashboard's own New project page.
- **Unlink** removes `supabase/.temp/project-ref` only; the Supabase project is untouched.

## What the drawer shows

For a linked folder: project and org, its state (Healthy, Paused, Restoring…; `projectState`), region, the API URL
(click to open the project's dashboard in the browser pane), the folder's migrations against the ones Supabase has
applied (`GET /v1/projects/:ref/database/migrations`, matched by the version before `_` in
`supabase/migrations/<version>_<name>.sql`, then by the name after it; "2 of 5 migrations not applied: …" in amber (the
counts are the folder's own: Weft's own `supabase/migrations/` holds ~46); each name links to the card that wrote its file, the latest card whose
`touchedFiles` hold it, `migrationOwner`), and links into the
dashboard on one line: Auth, Logs, Keys, Usage and Dash (`supabaseActions`). A paused project (free
projects pause after a week) gets **Restore** (`POST /v1/projects/:ref/restore`).

Status loads only while the drawer is open (`lib/use-supabase.ts`), on open, on folder change and on window focus. It opens on the last status it had (memory, then localStorage `weft:drawer-status:<name>`), refreshes it behind, and a focus asks again only after 30s (`lib/use-linked-status.ts`, shared by the three drawers).
A Weft started before this drawer existed has no `supabase:` handlers in main; the drawer says so and offers
Restart Weft (`needsRestart`).

## Files

- `electron/supabase.cjs`: `createSupabase` (status, token, projects, orgs, create, link, unlink, restore), the folder's side
  (`readLink`, `writeLink`, `localMigrations`) and `registerSupabase`, whose IPC handlers answer the board window only.
- `electron/preload.cjs`: `window.weft.supabase`. The token's own read/persist lives in `electron/provider-token.cjs`, which Vercel, Supabase, Cloudflare and BlastCP all share.
- `lib/supabase-view.ts`: types, the bridge, matching, labels, links. `lib/use-supabase.ts`: loading, over `lib/use-linked-status.ts` (the cache).
- `components/SupabaseDrawer.tsx` (linked folders, on the shared `components/FolderRow.tsx` — and its third "Link CLI…" button for a link the Supabase server made in `.mcp.json`; its token form is the shared `components/TokenForm.tsx`), `components/SupabaseLinked.tsx` (a linked project), `components/SupabasePicker.tsx` (Link…, on the shared `components/DbSelect.tsx` with `lib/db-picker.ts` `rankItems`),
  `components/SupabaseNewProject.tsx` (its New project form), `components/supabase-ui.ts` (the Supabase-only bits; `SMALL` is re-exported from `components/tone.ts`),
  `components/SupabaseLogo.tsx`.

### Migrate

The Supabase MCP's `apply_migration` stamps its own version (the time it ran), not the local file's, so a migration a
thread applied that way looked unapplied forever. `linkedStatus` in `electron/supabase.cjs` now counts a name match as
applied and reports it as `drift` (`{ name, local, remote }`); the line reads "… all applied; N under another version".

When anything is pending or drifted, **Migrate** sits at the end of the line (`migrationLine().fix`). It starts a card in
the folder (`lib/supabase-migrate.ts`, through the rail's `onStartCard`, Board's `improveQuality`) whose prompt lists the
pending migrations with the card that wrote each, and the drifted files. The card reads the history and the live schema,
writes a page with a risk badge per migration, asks for your OK with AskUserQuestion buttons, and on it applies them
oldest first (the MCP, or `supabase db push` for a CLI link), then `git mv`s each local file to the version Supabase
recorded, so the two histories match.

Migrate is for what's left over. A thread that writes a migration applies it itself in the same turn, the same way
(apply, `git mv` to the stamped version, advisors), and asks first, with buttons, only when it drops or rewrites data:
`MIGRATIONS_PROMPT` and `ASK_BUTTONS_PROMPT` in `lib/decisions-prompt.ts`, in every thread's system prompt (Codex,
which has no AskUserQuestion, gets the first only).

## Next

1. **Keys into the vault**: copy the project's URL and publishable key into the 🔐 vault as
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the service role key behind Touch ID.
3. **MCP for threads**: offer to add the Supabase MCP server for the linked project to `.mcp.json`.
4. **Usage and advisors**: security and performance advisors, and a badge when a project is paused or unhealthy.
