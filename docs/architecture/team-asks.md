# Team asks

Status: designed 2026-10-30. Only the foundations marked below are built.

One teammate needs something from another: a key, a project on their Mac, sync turned on, a fresh `.env.local`. Weft
has no way to say that today. This feature adds two things, and all five requests are made of them:

- **The roster**: who has which project, on which Mac, and how complete it is.
- **An ask**: from a person, to a person, about a project; open, done, declined or expired.

## What it does

| Request | Kind of ask | What accepting does |
| --- | --- | --- |
| Ask a teammate for a key | `key` | Fills a blank or replaces a dead value in the shared vault |
| Ask a teammate to update their keys | `refresh` | Weft takes over their `.env.local` and keeps it in step with the vault (`electron/env-writeback.cjs`) |
| Invite a teammate to a project | `join` | Clones it, approves the device, pulls keys, adds it to the board |
| See who has a project | none | The roster grid on the team's Projects page |
| Ask a teammate to sync | `sync` | Turns sync on for that project |

"Ask for this key" is one button. Weft works out what it means from the requester's state:

| Situation | What the ask does | Who can do it |
| --- | --- | --- |
| The vault is shared, this Mac isn't in it | Approve the device | Admin |
| The key is blank in the shared vault | Fill it | Any member |
| The key is dead | Replace it | Any member |
| The project has no shared vault | Share the vault | Admin |

It goes to whoever last wrote the key (`vault_secrets.updated_by`), otherwise an admin.

## Decisions

- **Synced means the team sees the cards.** A team project's cards go to the team workspace, not the personal one
  (`docs/architecture/cloud-sync.md`). So scoping cards and the vault by `org_project_members` is required, not a later
  step. A project already synced stays personal until its owner opts in, with a clear warning. Old cards don't move.
- **Every ask sends an email and shows a modal.** The email links back with `weft://`, because acting needs the Mac.
- **Touch ID on every accept.** Declining or sending needs none: neither touches a secret or the Mac.
- **The modal waits for a pause.** It never lands while someone is typing. Several asks show as one modal to step
  through.
- **One open ask per thing.** Asking again nudges the same ask. Asks expire after 14 days, like invites. The sender
  hears the outcome.
- **Admins send join asks.** Granting project access already takes `members.manage`. A member sees "Ask an admin".
- **It ships as one feature.** The build order below is only an order.

## Rules

- **An ask never carries a value.** Filling goes through the vault with Touch ID. There is nowhere to paste a key to a
  person.
- **An ask never acts on someone's Mac.** Sync uploads their threads, so it stays their click.
- **An ask's note never reaches an agent as instructions.** A teammate typed it. A thread only ever gets the kind and
  the key's name.
- **The Mac reports facts, not paths.** Repo name, yes or no, last seen. Never a folder path or a card title.
- **Approving a device says what it gives.** There's one key per vault, so approving a device gives every key in it,
  production included. Per-environment access would need one vault key per environment, which is a later project.

GitHub access stays a separate gate: `join` must check it and say so, because Weft can't grant it.

## Build order

1. **Foundations.**
   - Built: `public.share_vault` and `public.share_vault_recovery` wrap the private functions, which the desktop could
     never reach (`supabase/migrations/20261030181901_vault_rpc_wrappers.sql`, applied 2026-10-31).
   - Built: `registeredDevice` (`electron/device-key.cjs`) gives the vault this Mac's server id. The vault used the bare
     keypair, so sharing and accepting a grant had no device id.
   - Built: the heartbeat (`electron/device-beat.cjs`) moves `devices.last_seen_at` every 5 minutes.
   - To do: team sync, and scoping cards and the vault by project access.
2. **Roster and grid.** A record of member × device × repo, reported by each Mac.
3. **Asks for keys**, including the agent tool `mcp__secrets__request` from the roadmap: a card that needs a key parks in
   Needs you and resumes once the key arrives.
4. **Join a project.**
5. **Ask to sync and refresh.**

## Known gaps

- `registerDevice` upserts without `.select()`, so its returned `id` is null against a real database. `registeredDevice`
  reads the id back, so nothing depends on it, but the `vault:devices-register` answer does carry that null.
- The full share flow has never run against production: it had 0 vaults and 0 devices on 2026-10-30. Run it for real
  now the migration is applied, since other steps after the RPC may have the same kind of fault.
