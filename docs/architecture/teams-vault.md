# Teams vault

Status: **built** (2026-10-27). Step 4 of [secrets.md](./secrets.md) ("Supabase sync"), with the team shapes it
leans on. The local vault, device keypair, `.env` import, Touch ID, `mcp__secrets__*` tools, `.env.local`
write-back and redaction were already built (2026-10-12). Org tables (`orgs`, `org_memberships`, `invitations`,
every account with a personal workspace) shipped in `supabase/migrations/20261013155754_teams.sql`; billing
landed in `20261014010429_billing.sql`; the membership RLS helpers landed in `20261013161111_teams_rls.sql`. The
team pages (`/team`, `/{orgSlug}/team`, `/invite/:token`, the mailer, and the `lib/teams.ts` /
`lib/team-actions.ts` contracts) are built. The shared 🔐 vault is now built on top of them.

**What shipped.** The schema is in `supabase/migrations/20261027163113_team_vault.sql` (six tables, their RLS,
the `private.share_vault` RPC, the Realtime publication), with
`20261027165308_devices_upsert_unique_index.sql` (the `nulls not distinct` index that makes the device upsert
work) and `20261027173535_vault_recovery_key.sql` (`private.share_vault_recovery`) after it. All three are
applied to live Supabase. The desktop half: `electron/account-client.cjs` (main as the signed-in user, never
the service role), `electron/device-fingerprint.cjs` and `registerDevice` on `electron/device-key.cjs`,
`electron/vault-sync.cjs` (pull, push, the offline queue, Realtime), `electron/vault-grant.cjs` and
`electron/vault-share.cjs` (the TOFU wrap and the first-time share), `electron/vault-rotate.cjs` (rotate on
removal) and `electron/vault-recovery.cjs` (the 24 words). The board half: the shared badge and **Share this
vault** in `components/VaultShared.tsx`, the event log tab in `components/VaultEventsList.tsx`, the conflict
banner in `components/SecretRow.tsx`, and the workspace's **Devices** tab at `app/[orgSlug]/team/devices/`.

**What is still open.** The rename path (Q8) is out of v1 — a renamed repo orphans the old vault, and the
drawer surfaces the orphan rather than moving it. `docs/architecture/cloud-sync.md` still notes that thread
item bodies go up as plain JSON unless sealed; the workspace key that seals them is its own (mobile-security.md), not a vault's.

The point of the shared vault is the same as the local one — a secret's value never enters an agent's context
— extended to a workspace: a thread on a teammate's machine runs the same `mcp__secrets__list`, the same
`fill_field`, the same `run`, against the same names, and the same `mcp__secrets__push_to_vercel` pushes the
same values. The crypto is the same shape as 1Password or Bitwarden: one random vault key per vault, sealed
once per member device, ciphertext rows in Supabase, no key Weft holds. What teams add is the binding from a
device (the one with a private key) to a user (the one with a workspace membership).

This doc is the build plan: tables and RLS, how Electron main authenticates as a user (never as Weft), how a
local vault becomes a shared one, the sync model, granting a teammate's devices, removal + rotation, the
recovery key, what the drawer shows, offline behavior, and a step-by-step build order split into cards that
touch different files. Each open decision is flagged as a short question with a recommendation.

## What lands where

The split:

- **Supabase** holds: the `devices` table (one per Weft account × device), the `vaults` table (one per org ×
  GitHub repo, plus a recovery key), the `vault_grants` table (the vault key sealed to one device, one row
  per device × key version), the `vault_secrets` table (the encrypted values), and the `vault_events` table
  (an append-only log of who did what, no values). Every read goes through RLS, and RLS funnels through a
  `private.is_org_member(org uuid)` helper so the policies stay short.
- **Electron main** holds: the device keypair (already in `electron/device-key.cjs`, Keychain via
  safeStorage), the unwrapped vault key, and a per-vault `~/.weft/vault/<hash>.sync.json` shadow file that
  holds the latest server `version` and the row ids of everything we last saw, so a sync is a delta against
  the server and not a re-download. Main talks to Supabase through a **per-user JWT** it reads out of the
  sealed Supabase session (`electron/account-store.cjs`), never through the service role key.
- **The Next server** on Vercel is in this card only to host the RLS, the `private.is_org_member` helper, and
  the realtime publication. It does not see plaintext or unwrap keys.

All of the Supabase-side tables, policies and the `private.share_vault` RPC above are in the draft migration;
`private.is_org_member` itself already ships in `supabase/migrations/20261013161111_teams_rls.sql` (the draft
re-declares it so the migration stands alone). The Electron main half — the shadow file, the per-user JWT
client and the sync — is not built yet.

## Tables (Supabase)

All five tables are RLS-on. Writes from the desktop go through the user's authenticated client (the JWT in
`~/.weft/account.sealed`); the service role is not in this card's critical path, only the same `service_role`
the rest of Weft's API routes already use, for the very small things RLS can't express (creating a vault when
the org's first member asks, the recovery key grant, the realtime publication). The matching migration is
`supabase/migrations/20261027163113_team_vault.sql`, applied to live Supabase, with
`20261027165308_devices_upsert_unique_index.sql` and `20261027173535_vault_recovery_key.sql` after it.

### `vaults`

One row per **shared vault**. Identity is `(org_id, repo)` where `repo` is the GitHub `owner/name` lowercased
(`github:owner/name` is the local `vault id` shape today; the `repo` column drops the `github:` prefix and
stays `owner/name`). A vault is created on demand when the first member of an org asks to share a repo's
secrets; before that, the repo's vault is local-only and the row doesn't exist.

| column | type | notes |
|---|---|---|
| `id` | `uuid` pk | default `gen_random_uuid()` |
| `org_id` | `uuid` not null | `references public.orgs(id) on delete cascade` |
| `repo` | `text` not null | `owner/name`, validated as `[a-z0-9_.-]+/[a-z0-9_.-]+` |
| `label` | `text` not null | shown in the drawer; "weft" by default, editable in v1.1 |
| `current_key_version` | `integer` not null default 1 | bumps on rotate; grants pin their key version |
| `server_version` | `bigint` not null default 0 | bumps on every server-side change; clients compare |
| `created_by` | `uuid` references auth.users | the user that promoted the local vault |
| `created_at` | `timestamptz` not null default now() | |
| `updated_at` | `timestamptz` not null default now() | `private.touch_updated_at()` |

A single `(org_id, repo)` per vault. The owner-org's `id` is what scopes reads: every member of that org may
fetch the row, no one else may.

### `devices`

One row per (Weft account × device). A device is "a keypair we trust to read the user's orgs' vaults". The
private half lives in the macOS Keychain via `electron/device-key.cjs`; the public half is what other devices
fetch to grant the new one access.

| column | type | notes |
|---|---|---|
| `id` | `uuid` pk | default `gen_random_uuid()` |
| `user_id` | `uuid` not null | `references auth.users(id) on delete cascade` |
| `name` | `text` not null | the device's display name, "Weft on Adam's MacBook" |
| `public_key` | `text` not null | base64, X25519, 32 bytes |
| `fingerprint` | `text` not null | base64 SHA-256 of the public key, first 16 bytes, with colons every 2 bytes — what the TOFU UI shows |
| `platform` | `text` not null | `darwin` / `linux` / `win32`; the registration reads `process.platform` |
| `last_seen_at` | `timestamptz` not null default now() | updated on every sync, so a stale device can be flagged |
| `revoked_at` | `timestamptz` | a rotate-on-remove sets this; new grants never include it |
| `created_at` | `timestamptz` not null default now() | |

Uniqueness: `(user_id, public_key)` so re-registering the same device just bumps `last_seen_at` rather than
duplicating. RLS lets a user read their own devices, and the public key + name + fingerprint of any device
that already has a grant on a vault they belong to (so the TOFU comparison can show the right name on both
sides — see "Grants" below).

### `vault_grants`

The vault key, sealed. One row per (vault × device × key_version); the device is allowed in for that
version only.

| column | type | notes |
|---|---|---|
| `id` | `uuid` pk | |
| `vault_id` | `uuid` not null | `references public.vaults(id) on delete cascade` |
| `device_id` | `uuid` not null | `references public.devices(id) on delete cascade` |
| `key_version` | `integer` not null | matches `vaults.current_key_version` at grant time |
| `wrapped_key` | `text` not null | base64, libsodium sealed box, the same shape `electron/vault-crypto.cjs` produces |
| `granted_by` | `uuid` not null | `references auth.users(id)` — the user that ran the grant on this device |
| `granted_at` | `timestamptz` not null default now() | |

Uniqueness: `(vault_id, device_id, key_version)`. RLS: a user can read the row for one of their own
devices only (and only if they are a member of the vault's org). Without RLS, another member of the same
org could fetch a grant that isn't theirs and unwrap nothing (they don't have the private key), but the row
still leaks a fingerprint; the policy keeps it scoped to its device's owner.

A recovery key is a grant whose `device_id` is a sentinel: the recovery keypair's public half is a `devices`
row with `user_id = null` and `fingerprint = 'recovery'`, so the recovery card finds it by that fingerprint
rather than by a join on a special uuid. The private half of the recovery keypair is the
"recovery key" string the user is shown once at vault creation; it is not stored anywhere Weft keeps.
**Q1: where the recovery key string lives.** Recommend: nowhere. Show it once in the drawer at creation,
copy with a "I've saved it" button, then re-derive it from a user-entered pass-phrase on recovery
(`scrypt(passphrase, vault_id)` → the recovery keypair's private seed) so the user can also write it down
and recover without Weft. **Q2: a pass-phrase on top of the recovery key string.** Recommend: yes, because
otherwise a screenshot of the recovery key is the whole vault. The pass-phrase wraps the recovery key string
in memory before it becomes a keypair, and is never stored.

### `vault_secrets`

The ciphertext. One row per (vault × name × environment).

| column | type | notes |
|---|---|---|
| `id` | `uuid` pk | |
| `vault_id` | `uuid` not null | `references public.vaults(id) on delete cascade` |
| `name` | `text` not null | `^[A-Z_][A-Z0-9_]*$` enforced in DB |
| `environment` | `text` not null | check in `(development, preview, production)` |
| `ciphertext` | `text` | base64, XChaCha20-Poly1305, the same shape `electron/vault-crypto.cjs` produces |
| `nonce` | `text` not null | base64, 24 bytes |
| `key_version` | `integer` not null | which vault key version encrypted this row (so re-encryption only touches the ones whose key version changes) |
| `row_version` | `bigint` not null default 0 | bumped on every write, for `if-match` optimistic concurrency on edits |
| `updated_by` | `uuid` references auth.users | the user that wrote the row |
| `updated_at` | `timestamptz` not null default now() | |
| `is_blank` | `boolean` not null default false | a name the team put in for someone to fill in (`mcp__secrets__add_blank`); `ciphertext` and `nonce` are null |
| `hint` | `text` | blank rows only; where to get the value, from the thread that put it in |

Uniqueness: `(vault_id, name, environment)`. RLS: a member of the vault's org can read the row (ciphertext
only, and only the device that holds a matching grant can actually open it). RLS does not see the value, the
server doesn't have the key, and that's the whole point.

### `vault_events`

Append-only audit. What the drawer's "Event log" tab reads. No values, no ciphertext.

| column | type | notes |
|---|---|---|
| `id` | `uuid` pk | |
| `vault_id` | `uuid` not null | `references public.vaults(id) on delete cascade` |
| `actor_user_id` | `uuid` references auth.users | null for system events (a rotate-on-remove); we keep `actor_email` for the same reason `org_billing_events` does |
| `actor_email` | `text` | denormalized so the row survives the user being deleted |
| `device_id` | `uuid` references public.devices | the device the action came from; null for system events |
| `action` | `text` not null | `secret.added` / `secret.changed` / `secret.removed` / `secret.blank_added` / `secret.filled` / `device.added` / `device.removed` / `vault.rotated` / `vault.recovery_shown` |
| `target_name` | `text` | the name affected, when relevant |
| `target_environment` | `text` | the environment, when relevant |
| `metadata` | `jsonb` not null default '{}'::jsonb | e.g. `{ "key_version": 2 }` on a rotation |
| `created_at` | `timestamptz` not null default now() | |

Uniqueness: none — events are an audit log. RLS: a member of the vault's org can read the row. Realtime
publishes the table for the drawer's live feed.

## RLS

The shape every policy uses, except the two functions defined below:

```sql
create policy "<table>: read by member" on public.<table>
  for select to authenticated
  using (private.is_org_member((select org_id_from_<table>(<table>.*))));
```

Policies are short because membership is one function. Org admins can update the row (rename the vault,
revoke a device); the rest of the org can read. Writes from the desktop (the user's JWT) go through
INSERT/UPDATE policies that check membership AND that the actor is acting on their own device, and that the
`vault_id` in the row resolves to an org the actor is in. **No policy allows a user to insert or update a
`vault_grants.wrapped_key` for a device they don't own** — only the user that owns the target device may
write a grant for it. (This is what makes the TOFU flow possible: a teammate's device is the only place a
new wrapped key can be produced for it.)

The two helpers live in `private`:

```sql
create or replace function private.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_memberships
     where org_id = p_org and user_id = (select auth.uid())
  );
$$;

create or replace function private.is_org_role(p_org uuid, p_min text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- p_min is one of 'member' | 'admin' | 'owner'. owner > admin > member.
  select exists (
    select 1 from public.org_memberships
     where org_id = p_org
       and user_id = (select auth.uid())
       and case p_min
             when 'member' then role in ('member', 'admin', 'owner')
             when 'admin'  then role in ('admin',  'owner')
             when 'owner'  then role = 'owner'
           end
  );
$$;
```

`security definer` so the policies don't recurse into RLS on `org_memberships`, which has no policies
(20261013155754_teams.sql: "Access is enforced in app code on the deployed Weft"). Both are `stable` so the
planner caches one result per row in a single query. Both are `revoke`d from `anon, authenticated` after
`grant execute to authenticated` — they sit in the public function catalog so the planner can inline them,
but only the policies call them.

`private.is_org_member` already ships in `supabase/migrations/20261013161111_teams_rls.sql`, alongside
`private.org_role(org uuid)` (which returns the caller's role as text, and is what the applied team policies
use). The draft re-declares `is_org_member` so the migration stands alone, and adds `is_org_role(p_org,
p_min)` — the minimum-role check the vault's policies want.

**Q3: granting in `private` vs. an `internal` schema.** Recommend: `private`, matching the rest of the
migrations (`handle_new_user`, `touch_updated_at`, `org_slug_for`). The team card already uses it.

**Q4: do we ever need `security definer` for inserts?** Recommend: yes, exactly one — the **vault creation**
function that runs on the user's first INSERT into a not-yet-existent `(org_id, repo)`. The function runs as
the function owner and so can write the user's own device's `vault_grants` row. This keeps RLS simple (only
the function can write the very first grant on a vault) and matches how `org_subscriptions` is lazily created
today. (In the draft this is `private.share_vault(p_org_id, p_repo, p_label, p_device_id, p_wrapped_key)`,
which does exactly that: it checks `is_org_role(p_org_id, 'admin')`, inserts the vault, and inserts the first
`vault_grants` row in the same transaction.)

## How Electron main authenticates to Supabase

The desktop already holds a Supabase session in `electron/account-store.cjs` (refresh token included,
sealed by `safeStorage`). What the team's shared vault needs on top of that is a way for main to read and
write the vault tables **as that user** — RLS is what keeps a member of org A from reading org B's vaults,
and RLS only checks the JWT, not the source IP.

**The shape**: a small account client in main that wraps `@supabase/supabase-js` with the same
sealed storage adapter that `lib/account.ts` uses (`shellStorage` in `lib/account-storage.ts`). Main reads
the session from `~/.weft/account.sealed` on every call, decrypts it in process, hands the access token to
`supabase-js`. The refresh token is also reachable from main, so a 401 from Supabase triggers a refresh
inside the same wrapper, and the new tokens are written back through `account-store.cjs`'s `write`. The
sealed file is the single source of truth for the session; the board and main read the same file.

The board's own client is `accountClient()` in `lib/account.ts` — it builds the `supabase-js` client from
`SUPABASE_URL`/`SUPABASE_KEY` with `shellStorage` (or the file-backed `fileStorage`) as its storage adapter,
and it's what the board's own code reads the session through. Main has no equivalent yet: `electron/account-store.cjs`
exposes `createAccountStore({ dataDir, safeStorage })` with `read`/`write`/`sealed` over the same sealed file,
but nothing in `electron/` turns that session into a `supabase-js` client.

**The key rule**: this card's main never holds the service-role key. The service role is what the deployed
Weft's API routes use (`lib/web-session.ts` `serviceClient()`); main is the desktop. RLS scopes main's
queries to the signed-in user, and the matching published key (`lib/supabase-project.ts` `SUPABASE_KEY`)
is what `supabase-js` is constructed with on the main side, not the secret key. A teammate's vault is
unreadable to the signed-out desktop; it's unreadable to a signed-in user who's not a member of the org;
it is not unreadable to Weft's servers, which is the point.

**Q5: where the wrapper lives.** Recommend: `electron/account-client.cjs`, a new file. It exports
`createAccountClient({ dataDir, safeStorage })` returning `{ read, write, getClaims, supabase }`. Main's
`setupVault` is the only caller in this card; the Vercel env push (`electron/vercel-env.cjs`) and the
Vercel events subscriber (`lib/vercel-hooks.ts`'s main-side counterpart) adopt it in their own cards.
`lib/account.ts` keeps its own client for the board; the two are the same shape but never share state in
memory, so the desktop can be signed in as one user in the board's UI and refresh on a different schedule
than main (they don't today, but the seam is what makes the next card cheap).

## Device registration

The first time a signed-in Weft opens a shared vault, main does:

1. **Ensure the device row exists.** `loadDeviceKey()` in `electron/device-key.cjs` already returns the
   keypair. Call a new
   `accountClient.from("devices").upsert({ public_key, fingerprint, name, platform }, { onConflict: "user_id,public_key" })`.
   Conflict is a no-op (`last_seen_at = now()` is the only thing the trigger updates). The user_id comes
   from the JWT, not the client. The display name is the device's hostname; the user can rename it in
   `Settings → Threads → Devices` (not in this card).
2. **Ensure the device has a grant.** For each vault this device is meant to open, fetch a grant. On a
   fresh device, the user is the only one who can produce a grant for it, so the flow is "owner signs in on
   the new device, opens the vault, the drawer says 'You need a teammate to grant this device — open
   `[orgSlug]/team/devices` to add it'." A teammate's existing Weft produces the grant from their own main.

The TOFU check: when a new device joins, both sides show the **fingerprint** of the new public key, in
short groups like `7a1f 8b3c 0d4e 2a5b 6f9c …`. The new device's fingerprint is what it just registered;
the granter's Weft shows it back from the row it just fetched. The user compares the two strings. A
compromised server that slipped in its own key would show two different fingerprints, and the comparison
fails before the wrapped key is even produced. The check is mandatory at the grant — the UI does not let
the user skip it.

**Q6: who decides the device name.** Recommend: the user, on first registration, prompted once with a
sensible default ("Weft on `<hostname>`"). Saved in `~/.weft/device-key.json` next to the keypair, sent
on every upsert. The `Settings` page lets the user rename later (out of this card's scope).

## How a local vault becomes a shared one

The local vault's `~/.weft/vault/<hash>.json` is the source of truth on the disk. When the user (any user in
the org) signs in and the folder is the GitHub repo, the drawer offers **"Share this vault with
`<org name>`"**. The first time it's pressed for an org, main:

1. Creates a `vaults` row for `(org_id, repo)`. This is the one INSERT that goes through a `security
   definer` function, because it has to write the first `vault_grants` row for the user's own device in the
   same transaction. The function reads the user's `devices.public_key` and produces the wrapped key
   locally… actually no, the function can't. The wrapped key is a libsodium `crypto_box_seal` over the
   user's *own* public key, which only that user's private key opens. The function needs the public key; the
   ciphertext is computed **client-side** in main, then the function inserts the row with the pre-computed
   wrapped key. This is the same split as `puku_trial_add` (the trial's meter is updated by a `security
   invoker` SQL function, but the input it accepts is the user's count, not the user's token). The
   migration's `private.share_vault(p_org_id, p_repo, p_label, p_device_id, p_wrapped_key)` is
   `security definer`, checks `is_org_role(p_org_id, 'admin')`, and inserts both rows in one transaction; a
   race on `(org_id, repo)` is caught by the unique index and returns the existing vault's id, so two
   clients sharing the same local vault get the same result.
2. Imports the existing local `vault.id` ciphertext rows as new `vault_secrets` rows. The wrapped key is
   already what it was (the local vault key is *kept* as version 1 of the shared vault key — a team member
   who joins later gets the same key sealed to their own public key, not a new one). The `id` of the
   shared vault is the org's uuid, not the local "github:owner/name" — local stores keep using the local id
   for the file path and the IPC bridge; the IPC layer translates.
3. Marks the local file as **shared** by writing a `shared.json` next to it: `{ orgId, vaultId, repo,
   keyVersion: 1 }`. From this point on, the local file is a **shadow** of the server state: a write
   through the local API goes to Supabase, then the response is the new row, which is written into the
   local shadow. The local file is no longer the primary store; it's a read cache so the board can render
   without a round-trip.

A `git ls-remote` check confirms the repo name matches a real GitHub repo, so a typo can't lock a vault to
a misspelled org-scoped name. (The drawer's project filter already shows the local repo label, so a typo
is visible — but the check is one line and saves a rename later.)

**Q7: what the local "shadow" looks like on disk.** Recommend: one `~/.weft/vault/<hash>.sync.json` per
shared vault, alongside the existing `<hash>.json`. The sync file holds `serverVersion` (bigint), a map of
`(name, env) → rowId + rowVersion`, and the `vaultId` and `orgId`. The local `.json` keeps the same shape
it has today and is the unwrapped working copy main decrypts into memory.

**Q8: the rename path.** Recommend: in v1.1, not v1. The `vaults.repo` is the immutable join key. A user
who renames a GitHub repo gets a new vault the next time someone opens the project at the new name, and
the old vault is orphaned. The drawer surfaces "this repo was renamed; `<old repo>` has `<N>` secrets"
with a one-button "Move them to `<new repo>`" that re-encrypts under the new vault's key. For v1, the
drawer just shows the orphan and a manual export.

## Sync model

A shared vault is read and written in main, with the Supabase server as the source of truth.

**Pull on open.** When the board opens the 🔐 drawer with at least one shared vault, main reads the
`serverVersion` of every shared vault it knows about, and asks Supabase for `vault_secrets` rows where
`row_version > lastSeenRowVersion` (and any new `vault_grants` for this device). The result is the diff:
new secrets, changed names, and any devices that joined or were removed since the drawer was last open.
Realtime (`alter publication supabase_realtime add table …`) keeps the drawer live: a teammate's
`mcp__secrets__set_value` shows in the 🔐 panel within a second or two, and the event log updates as
events land.

**Push on change.** Every write — a typed value, an import, a copy-to, a remove, a blank — is a
transaction: `insert into vault_events … ; insert into vault_secrets … on conflict (vault_id, name,
environment) do update set … , row_version = vault_secrets.row_version + 1 where vault_secrets.row_version
= $expected`. The `where` is the optimistic-concurrency check. A conflict (someone else wrote the row
between the user's last read and this write) returns `{ conflict: true, current }` and main asks the
drawer to re-render and retry; the user is shown "Sam changed `API_KEY` in development — keep your
edit?". For a value, this is a hand resolve; for a blank added by a thread, the conflict is rare and the
drawer silently keeps the new value. **Q9: conflict UX on a thread-generated value.** Recommend: the
thread's `mcp__secrets__set_value` re-reads after a conflict, and on a row that is no longer a blank,
returns the same `filled: true` it would have if the user had filled it themselves. Threads do not retry
blindly; a real user edit wins.

**Realtime subscriptions.** Three tables get `alter publication supabase_realtime add table`: `vault_secrets`,
`vault_events`, and `vault_grants` (so a new grant for this device arrives and main can immediately unwrap
the vault key). The desktop's Supabase client subscribes per vault, scoped by `vault_id = …`, and the
client-side filter keeps main from receiving events for vaults it has no grant on. RLS still applies on
the server side, so a misconfigured client gets nothing.

**Optimistic UI in the drawer.** The drawer's row state is the **local shadow**, not the server. A write
posts to Supabase, and on the 200 the local shadow is updated to the server's row. On a 409, the local
shadow is rolled back and the row is re-rendered with the server's current state. The drawer does not
optimistically show "saved" before the server confirms — Touch ID is the gate, and after Touch ID the
round-trip is sub-200ms, so the optimism isn't worth the rollback code.

## Granting a teammate's devices

The owner (or any `admin`) opens the team's **Devices** page on the deployed weft.zip (a
`app/[orgSlug]/team/devices/page.tsx` this card would add; today the team page is
`app/[orgSlug]/team/page.tsx`, which has Members, Pending, Projects and the role picker, but no Devices
tab). The page shows every registered device across the team: name, platform, last seen, fingerprint. The
page is a static list (RLS scopes it to members of the org) and three buttons:

- **Invite a teammate's device**: opens a small dialog asking for the device's fingerprint. The teammate
  reads theirs from their own Weft's `Settings → Threads → Devices → "Show fingerprint"` (which is just the
  same dialog, signed in). The user pastes the fingerprint, presses **Add**, the server adds a
  `pending_device_grants` row with the fingerprint and the granter's user id. A `vault_grants` row is not
  written yet.
- **The teammate's Weft hears about the pending grant.** Realtime on `pending_device_grants` for the
  signed-in user (RLS: a user sees rows where `target_user_id = auth.uid()`). A banner shows up: "`<granter
  name>` wants to add a device to `<vault>`. Show the fingerprint?" — yes reveals the fingerprint and the
  expected key (the user has to read both out of band, by voice or by being next to the granter, because
  the whole point is to keep a compromised server from substituting its own). Accept sets the pending row's
  `matched_device_id` (and `target_public_key`) to the user's actual `devices.id`, and from there
  `vault_grants` is inserted in a server-side transaction (the wrap happens client-side on the granter's
  Weft — see "who wraps" below). The user has now accepted the new device.
- **The granter's Weft wraps the new device.** A `vault_grants` row needs the wrapped key. The granter
  does the wrap: their main holds the unwrapped vault key, the new device's `public_key` was on
  `pending_device_grants`, and `crypto_box_seal(vaultKey, newDevicePublicKey)` is the wrap. The granter's
  main posts the resulting `wrapped_key` keyed by the device's uuid, and the `pending_device_grants` row
  is deleted in the same transaction. Realtime on the new device's machine fires; main unwraps the vault
  key, decrypts the cached ciphertext rows, and the local shadow is filled.

**Who wraps.** Strictly the granter. The new device's private key never leaves its own machine; the wrap
needs the new device's public key, and the unwrap needs the new device's private key. The granter's main
is the only one with both. The server only sees the wrapped key, never the vault key.

**The fingerprint UI.** Two screens, one comparison. Both sides format the fingerprint as
`a1b2 c3d4 e5f6 7890 abcd ef01 …` (16 hex pairs, 8 groups of 4 — the first 16 bytes of SHA-256 of the
public key, base64-decoded, colon-grouped). On the new device, `Settings → Threads → Devices → "Show
fingerprint"` is a single line of text in a copy-friendly monospaced font, with a **Copy fingerprint**
button. On the granter's side, the same string is shown next to the new device's pending row. The two
must match. The UI does not enforce the comparison (it can't); the user has to do it, and the docs
explain why (Signal's safety number, but a one-time check).

**Q10: when the user has no teammates yet.** Recommend: the team page has an "Add this device" flow for
the user themselves, so a second device on the same user's account is its own TOFU check. Same shape, just
a one-row `pending_device_grants` with `target_user_id = auth.uid()` and the new device's fingerprint.

## Removal and rotation

Removing a teammate (or revoking a single device) is what secrets.md calls **rotate-on-remove**: any
plaintext the removed party ever held is gone, and they get a fresh grant for the new key. The flow is
triggered from the team page:

1. **Admin clicks "Remove `<name>` from workspace"** (the existing team action) **and ticks "Rotate shared
   vaults"** (a new option, since the rotate is a heavier operation and a simple remove doesn't need it).
2. **Bump the vault key.** For every vault this user had access to, `vaults.current_key_version += 1`,
   generate a new vault key on the **admin's** main, and re-wrap it to every other member device's public
   key (and to the recovery key). The old wrapped keys stay around in `vault_grants` for one cycle so a
   teammate who was offline at rotate time can still read ciphertexts that were encrypted under version N
   when they sync next; their first sync after rotate re-encrypts those rows under version N+1.
3. **Re-encrypt the secrets.** Every `vault_secrets` row whose `key_version < newVersion` is re-encrypted
   by its author's device on next sync (it's the natural place — the unwrap is in main, the re-wrap is
   one libsodium call, and the row is written with the new `key_version` and the same `row_version + 1`).
   Devices that were online during the rotate do this immediately; offline devices re-encrypt on reconnect
   before the drawer shows their vault.
4. **Revoke the device.** `devices.revoked_at = now()`. New grants never include this device; a
   `vault_grants` row is deleted if the device is the only one for that key version. The revoked device
   cannot fetch a new grant (RLS on `vault_grants` requires a non-revoked device), and even if it could,
   the unwrap would fail because no grant row exists for the new key version.
5. **List the secrets they could read.** A rotate doesn't take plaintext back from a device that had it
   before. The team page shows "Rotate the following values at their providers: `<list of names>`" — a
   plain, copied-friendly list, with a "Mark rotated" button per row that writes a `vault_events` row.

**Q11: what the rotate button does when only one device is online.** Recommend: a rotate is
**per-vault, not per-org**, and a per-vault rotate can be a no-op if the user being removed had no grants
on it. The team page shows "Remove from 1 of 3 vaults" and lets the admin uncheck the others. The
**per-vault rotate is the same code** as the "this device was lost, rotate before adding the new one"
flow, which is its own card.

**Q12: removing a single device, not the user.** Recommend: a separate "Remove this device" button on the
team's Devices page. Same rotate path, but scoped to that device's `vault_grants`; the other devices keep
their grants. RLS prevents the removed device from reading any new grant.

## Recovery key

**Built (card 10, 2026-10-27).** `electron/vault-recovery.cjs` holds the crypto — `makeKey`, `show`,
`recover`, `recoveryStatus` — and `electron/vault-recovery-words.cjs` the wordlist and the encoding
(`electron/recovery-wordlist.json` is the 2048-word English list). The page is
`app/[orgSlug]/team/vaults/[vaultId]/recovery/` (`page.tsx`, `RecoveryKey.tsx`, `queries.ts`), the route
is `app/api/team/vaults/[vaultId]/recovery/route.ts`, the rows are written by the
`private.share_vault_recovery` RPC (`supabase/migrations/20261027173535_vault_recovery_key.sql`), and the
drawer's item is in `components/VaultDrawer.tsx`. Two details the design above left open, settled in the
build: the words are made in **Electron main** (the vault key only exists there, so the server cannot
derive them — the page asks the desktop for them behind Touch ID), and the passphrase is applied to the
seed *before* the keypair is made, so the words carry the passphrase-derived seed and the server's public
half cannot be used to derive them back.

A vault's recovery key is a separate device row, owned by no one, found by its `fingerprint = 'recovery'`
(the recovery card looks it up that way, not by a special uuid). The keypair is generated at vault creation:

- The **public key** is returned as a `devices` row with
  `user_id = null` and `name = 'recovery'`. RLS lets members of the org read it (just the public key +
  fingerprint, no wrapped key).
- The **private key** is the recovery key string the user is shown once. It is encoded as 24 words from a
  fixed BIP-39-style wordlist (we use the standard 2048-word English list, no checksum — the words are
  for the user to write down, the math is libsodium's). With a passphrase (Q2), the words alone are not
  enough to open the vault.

**Showing the recovery key** is its own page, with a single button: "Show recovery key for `<vault>`".
Touch ID opens it, the words are revealed in a 4×6 grid, **Copy words** puts them on the clipboard for
60 seconds (the existing `CLIPBOARD_MS` in `electron/vault.cjs`), and a checkbox the user must tick to
continue: "I've saved these words somewhere safe." Closing the page or un-ticking re-locks it. The key is
shown once per vault; **a re-show requires a Touch ID and a fresh 24-word generation** (so the old words
stop working), which is the same shape as Signal's safety number re-roll.

**Recovering.** A new device, signed in to the same Weft account, opens the **Recover a vault** flow:
pastes the 24 words, the passphrase (if any), and the vault name (`owner/name`). Main re-derives the
recovery keypair, fetches the matching `vault_grants` row, unwraps, and the vault is local. The
`vault_grants` row for the recovery device is left in place; the user can then grant the new device from
the team page as usual.

**Q13: which vaults get a recovery key by default.** Recommend: every shared vault. The recovery key
generation is two libsodium calls and one INSERT; the "show words" page is one route. The alternative
(opt-in, per-vault) is the kind of footgun that loses vaults when a teammate leaves and the owner is on
holiday.

## What the 🔐 drawer shows

Today (`components/VaultDrawer.tsx`, `lib/vault-view.ts`): the project filter, a list of vaults, the
environments within a vault, each secret's name and tail, an Add form, an Import preview, the Vercel diff.
The shared-vault changes are additive, not a rewrite:

- A **vault header** with the org's name, the GitHub repo, and a small "shared" badge when the vault is
  shared (the local id is replaced by the shared one in the header). The current key version is shown
  next to the name, in monospaced font: `v3` (rotating from v2). Tooltip explains "vault key version 3 —
  bumped on `<date>` by `<actor>`".
- An **Event log tab** (alongside the secrets tab, in the same drawer): the last 100 `vault_events` for
  this vault, in reverse-chronological order. Filtered by what the current user did (default) or "all
  members" (the team's view). The tab is on the drawer, not its own page, so the secret is one click away
  from "Sam changed this on Tuesday."
- A **Members tab** (own page, the team page's "Devices" subpage is enough in v1; the drawer shows the
  member count, the member list lives in `/{orgSlug}/team`). The drawer is for secrets, the team page is
  for people.
- A **recovery key button** in the vault header's overflow menu: "Show recovery key" → the page above. The
  recovery device row is a small chip in the header.
- **Conflicts** are a transient banner, per-secret, for the secrets the current user just edited. The
  banner sits **on that secret's own row** (`components/SecretRow.tsx`), not in a strip above the
  list: it names who changed the secret, in which environment, and offers the two ways out. The
  banner goes away on re-render after a reload.

**Q14: live event log on the drawer.** Recommend: yes, via Supabase Realtime. The drawer's already loading
on focus; adding a `vault_events` subscription on open is one `supabase.channel(...).on('postgres_changes', ...)`
call, and the events come in as `appendChild` rows.

**Q15: when the user is the only member of the org.** Recommend: a personal workspace's vault works
exactly like today's local vault, with a single grant for the user's own device and a recovery key. The
`"Share this vault with …"` button in the drawer is the one that promotes it to a team vault, and is
hidden when the user is the only member of the org (a team of one doesn't need to share with itself).

## Offline behavior

The local shadow file is the offline source of truth. Reads work without a network: the shadow has the
last known ciphertext, and the unwrap is local. Writes are queued:

- A write that happens offline is **enqueued** in `~/.weft/vault/<hash>.queue.jsonl`, one JSONL row per
  write: `{ op: "set" | "remove" | "blank", name, environment, value?, hint?, expectedRowVersion,
  expectedServerVersion, queuedAt }`. The drawer's row shows "queued" next to the name, in a small chip.
- On reconnect, the queue is drained in order. A drain is a Supabase transaction: for each entry, check
  `vaults.server_version` against `expectedServerVersion`. If the server is at a higher version, the
  drain re-fetches the conflicting rows and re-applies the queue against the latest `row_version`. A
  conflict is a hand-resolve (the same UX as a live conflict), but the queue is left intact until the
  user resolves, so no write is lost.
- A rotate that happened on the server while a device was offline shows up in the next sync as "vault key
  v3" in the header. The device re-encrypts the rows it had cached and pushes them as `key_version = 3`.
  The drawer's "Re-encrypting… 14 of 47" progress lives in the vault header until the device is caught
  up; nothing else is blocked.

**Q16: does a read require a network.** Recommend: no. The shadow has the ciphertext; the unwrap is local.
The only network on read is the Realtime subscription, and that failing is silent (the drawer just
doesn't live-update). The "queued" chip on a write is the user-visible offline signal.

## How a member of one org can read a vault they belong to but whose GitHub repo the local Weft doesn't have

A teammate clones the repo, opens it in their Weft, the local `git remote` matches the vault's `repo` —
no extra configuration. A teammate who *hasn't* cloned the repo can still open the vault from
`Settings → Threads → Vaults` (a list of every shared vault they belong to, with a "Browse secrets"
button that opens the drawer with a fake "folder" entry pointing at the vault id). The local shadow is
filled from the server on first open. The "📋 Copy a value" right-click menu still works because the
unwrapped vault key is in memory; copying to another vault is hidden because there is no folder to copy
into. **Q17: where this lives.** Recommend: `Settings → Threads → Vaults` in this card, the UI is one
list and one button; the underlying IPC is the same `vault:overview` route with a special folder string
the server-side stub returns a vault for.

## Step-by-step build order

The cards below are scoped so each touches a different set of files and can run in parallel without git
worktrees. Dependencies are listed; cards with no dependency can run in any order. **Files added** are new;
**files edited** are existing.

**All twelve shipped on 2026-10-27.** The list is kept as the record of how the build went: what each card
touched, what it depended on, and where the code landed. The file lists below name the files each card added
or edited — they are all in the repo now, under the names given.

### Card 1: schema + RLS — the migration

**Files added**: `supabase/migrations/20261027163113_team_vault.sql` (applied to live Supabase), plus
`20261027165308_devices_upsert_unique_index.sql` and `20261027173535_vault_recovery_key.sql` after it.

**Files edited**: none.

**Test**: this card doesn't ship with code, but the migration runs cleanly against a fresh `supabase db
reset`. The `private.is_org_member` and `private.is_org_role` helpers are exercised by hand in
`psql` against a seeded `org_memberships` row.

**Depends on**: nothing. The migration references `public.orgs` and `public.org_memberships` (already
shipped in 20261013155754_teams.sql). The billing migration
(20261014010429_billing.sql) doesn't touch any of these tables.

**Cards that depend on this**: every other card.

### Card 2: account client on the desktop

**Files added**: `electron/account-client.cjs` (the wrapper around `supabase-js` with
`shellStorage`/`account-store.cjs` for the sealed session), `electron/account-client.test.ts` (vitest,
mocks `electron.safeStorage` and `account-store.cjs`'s read/write).

**Files edited**: none.

**Test**: the test fakes `safeStorage` (so a sealed write is the bytes unchanged on read), drives
`read → mutate session → read` and checks the sealed file changed. The unit-level mocks keep the
"secret never logged" invariant (no `console.log` of the access token; the test asserts with a snapshot
of the file).

**Depends on**: nothing. (The board's own account client in `lib/account.ts` is unchanged.)

**Cards that depend on this**: cards 3, 5, 7, 8.

### Card 3: device registration + TOFU fingerprints

**Files added**:
- `electron/device-fingerprint.cjs` — small helper: `fingerprint(publicKey)` returns the 16-byte
  SHA-256, base64-decoded, colon-grouped string.
- `electron/device-fingerprint.test.ts` — fixtures for a few known keypairs.

**Files edited**:
- `electron/device-key.cjs` — `loadDeviceKey()` already returns the keypair; add a sibling
  `registerDevice({ accountClient, name, platform })` that calls
  `accountClient.from('devices').upsert(...)`. The function is idempotent
  (`onConflict: 'user_id,public_key'`, only `last_seen_at` changes on conflict).
- `electron/preload.cjs` — add a `devices` entry (list, register, fingerprint) to the `weft.vault`
  namespace, so the board can read its own devices.

**Test**: `electron/device-fingerprint.test.ts` covers the grouping. `electron/device-key.cjs` is
unchanged for the local-vault flow; the new `registerDevice` is integration-tested in card 7.

**Depends on**: card 2.

### Card 4: the migration's `share_vault` RPC and `pending_device_grants` table — Supabase-only

**Files added**: folded into card 1's migration — `supabase/migrations/20261027163113_team_vault.sql`, one
file with both.

**Files edited**: none beyond card 1's migration.

This is the RPC the team page calls when an admin clicks "Add a teammate's device". It writes the
`pending_device_grants` row, scoped to the org, and RLS refuses to a non-admin. The
`private.is_org_role` helper from card 1 is the gate.

**Test**: psql hand-tests for an org_admin vs an org_member; the latter is rejected.

**Depends on**: card 1.

### Card 5: sync engine in main — pull, push, queue

**Files added**:
- `electron/vault-sync.cjs` — `createVaultSync({ accountClient, supabase, sodium, now })`. Exposes
  `pull(vaultId)`, `push(vaultId, op)`, `subscribe(vaultId)`, `drain(vaultId)`. The function holds the
  Realtime subscription in a Map and tears it down on `close()`.
- `electron/vault-sync.test.ts` — vitest, mocks `accountClient` (a `select`/`upsert`/channel fake), uses
  the existing `lib/runner.harness.ts` style of fake. Coverage target: 100% lines.

**Files edited**:
- `electron/vault-store.cjs` — the `set`/`remove` methods now go through the sync engine, not just the
  local file. The local file is the **shadow**; the server is the source of truth. `set` is
  `push({ op: "set", name, env, value, expectedRowVersion })`; on success, the response row is written
  to the local shadow. The local API (called by `electron/vault.cjs` and the IPC bridge) is unchanged.
- `electron/vault.cjs` — `registerVault`'s `vault:overview` and `vault:reveal` call `pull(vaultId)`
  first when the vault is shared; the local store handles personal vaults. The "queued" chip is
  computed by reading `~/.weft/vault/<hash>.queue.jsonl` size.
- `electron/main.cjs` — wires `createVaultSync` into `setupVault`'s `createVault` call. Reuses the
  same `accountClient` from card 2.

**Test**: `electron/vault-sync.test.ts` (card 5's main test), plus the `electron/vault-store.cjs`
tests still pass with the new shadow semantics — the public API didn't change, only the backing store.

**Depends on**: cards 1, 2, 3 (the device row needs to exist for the sync to attach a `device_id` to
events).

### Card 6: the 🔐 drawer's "shared" badge + "Share this vault" button

**Files added**:
- `components/VaultParts.test.tsx` — vitest jsdom, the existing test setup.

**Files edited**:
- `components/VaultParts.tsx` — add `<SharedBadge vault={…} />` (a chip in the vault header) and
  `<ShareOffer folder={…} org={…} onShared={reload} />` (a banner at the top of a local vault when
  the user is in an org).
- `lib/vault-view.ts` — `VaultSummary` grows `shared?: { org: { id, slug, name }, keyVersion,
  serverVersion, recoveryShownAt }`. The IPC bridge returns it; local vaults have `shared: undefined`.
- `lib/use-vault.ts` — `useVault` reloads when `shared.serverVersion` changes (a pub/sub on the local
  shadow file's mtime, since the next pull is what changes the number).
- `electron/vault.cjs` — `overview()` adds the `shared` block by reading the `shared.json` next to
  the local file.

**Test**: `components/VaultParts.test.tsx` (jsdom). Coverage of the local-vault path stays at 100%
because the `shared` block is purely additive.

**Depends on**: card 5 (the `shared` block is what the sync engine writes next to the local file).

### Card 7: team Devices page (deployed weft.zip) and the TOFU acceptance flow

**Files added**:
- `app/[orgSlug]/team/devices/page.tsx` (server component, calls `requireTeam(slug)`, fetches the
  devices list through a service client because the list crosses users).
- `app/[orgSlug]/team/devices/DeviceRow.tsx`, `PendingGrantForm.tsx`, `AddDeviceForm.tsx` — client
  components for the page.
- `app/api/team/devices/route.ts` — `POST` creates a `pending_device_grants` row; `DELETE` removes
  one. RLS gates; the route is just a thin wrapper.
- `app/api/team/devices/accept/route.ts` — `POST` from the accepting device, sets the pending row's
  `matched_device_id` and `target_public_key`, returns the new device's `public_key` so the granter's
  main can wrap.
- `lib/team-devices-view.ts` and `.test.ts` — the helpers the page calls.

**Files edited**:
- `app/[orgSlug]/team/page.tsx` (already on the team card's scope) — adds a **Devices** tab next to
  Members, Pending, and the role picker.

**Test**: route tests in `app/api/routes.test.ts`. The lib helpers are unit-tested in
`lib/team-devices-view.test.ts`.

**Depends on**: cards 1, 2, 4 (the RPC, the account client, the migration).

### Card 8: wrap, grant, and the local shadow

**Files added**:
- `electron/vault-grant.cjs` — `wrapForDevice({ vault, granterDevice, newDevice })` and
  `acceptGrant({ vault, myDevice, wrappedKey })`. The wrap is a libsodium `crypto_box_seal`, which
  `electron/vault-crypto.cjs`'s `wrapKey(vaultKey, publicKey)` already does. Both functions are one
  screen of code, mostly the same shape.
- `electron/vault-grant.test.ts` — fixtures for a granter + new device keypair, asserts the
  wrap/unwrap round-trips and the AAD.

**Files edited**:
- `electron/vault-ipc.cjs` — a new IPC handler the deployed Weft's "Accept" button calls. It reads
  the granter's pending row, fetches the new device's `public_key`, wraps the vault key, and posts
  the `vault_grants` row through `accountClient`. (The name has to differ from the existing
  `vault:grant`, which hands a card's thread access to the vault — that one is already in
  `electron/vault-ipc.cjs` and means something else.)

**Test**: `electron/vault-grant.test.ts` (libsodium fixtures), plus the existing
`electron/vault-store.test.ts` (already covers the wrap/unwrap round-trip through
`electron/vault-crypto.cjs`).

**Depends on**: cards 3, 4, 5, 7.

### Card 9: rotate-on-remove

**Files added**:
- `electron/vault-rotate.cjs` — `rotate({ vaultId, removedDeviceId, accountClient })`. Bumps
  `current_key_version`, generates a new key in main, re-wraps to every other device, re-encrypts
  every secret the device had access to, and writes `vault_events`. The "list secrets to rotate at
  the provider" is a `vault_secrets` SELECT scoped to the removed device's old grants.
- `electron/vault-rotate.test.ts` — fixtures for a 3-device vault, asserts the new key seals to
  the two remaining devices and the removed one has no new grant.

**Files edited**:
- `app/[orgSlug]/team/page.tsx` — the "Remove member" form gains a "Rotate shared vaults"
  checkbox, defaulting to on.
- `lib/team-actions.ts` — `removeMember(orgSlug, userId)` gains the rotate: when the box is ticked,
  it triggers the rotate before the membership delete.

**Test**: `electron/vault-rotate.test.ts`.

**Depends on**: cards 1, 5, 7, 8.

### Card 10: recovery key

**Files added**:
- `electron/vault-recovery.cjs` — `generate({ vault, accountClient })` (creates the
  `devices` row with `fingerprint = 'recovery'`, the BIP-39 wordlist encode), `show({ vault })`
  (returns the words once, gated by a `vault_events` row with action `vault.recovery_shown`),
  `recover({ words, passphrase, vault })` (re-derives the keypair, fetches the grant, opens the vault).
- `app/[orgSlug]/team/vaults/[vaultId]/recovery/page.tsx` — the "Show recovery key" page.
- `app/api/team/vaults/[vaultId]/recovery/route.ts` — `GET` returns the words (Touch ID in main, the
  page is a thin shell), `POST` acknowledges the "I've saved it" tick.

**Files edited**:
- `electron/vault.cjs` — the IPC `vault:recovery` handler.
- `components/VaultDrawer.tsx` — the **Show recovery key** menu item.

**Test**: `electron/vault-recovery.test.ts` (word round-trips, passphrase derivation), plus a
component test for the page's "I've saved it" gating.

**Depends on**: cards 5, 7, 8.

### Card 11: event log tab in the 🔐 drawer

**Files added**:
- `components/VaultEventsList.tsx` — the tab body, a virtualized list of 100 rows, Realtime
  subscription.
- `lib/vault-events.ts` and `.test.ts` — the IPC contract: `bridge.events(vaultId, { since })`.

**Files edited**:
- `electron/vault.cjs` — `vault:events` IPC handler (a `select` on `vault_events` ordered by
  `created_at desc`, paged).
- `components/VaultDrawer.tsx` — the tabs.

**Test**: `components/VaultEventsList.test.tsx` (jsdom), `lib/vault-events.test.ts`.

**Depends on**: card 5.

### Card 12: conflict UX in the drawer

**Files edited**:
- `components/SecretRow.tsx` — the conflict banner.
- `lib/vault-view.ts` — a `vaultConflict` field on the response of `vault:set`.
- `electron/vault-store.cjs` — `set` returns `{ conflict: true, current }` instead of throwing on a
  row_version mismatch (the existing `set` is in-process and doesn't have a version to check; the new
  one does, through the sync engine).

**Test**: an extension to `electron/vault-store.test.ts` that fakes a row_version mismatch.

**Depends on**: card 5.

## Open questions, with recommendations

- **Q1 — where the recovery key string lives.** *Show once, never stored.* The user writes it down. The
  pass-phrase (Q2) wraps the key string in memory so a screenshot isn't the whole vault.
- **Q2 — a pass-phrase on top of the recovery key.** *Yes, scrypt(passphrase, vault_id) → wraps the
  recovery keypair's private seed.* Keeps the recovery flow usable with a paper backup and resistant to
  a leaked screenshot.
- **Q3 — `private` vs. `internal` schema.** *`private`, matching every other migration.*
- **Q4 — `security definer` for inserts.** *Yes, one — the `private.share_vault` function that creates the
  first grant alongside the vault row.*
- **Q5 — where the account client lives.** *`electron/account-client.cjs`.* A new file, not folded into
  `account-store.cjs`, so the storage adapter and the Supabase wrapper stay separate.
- **Q6 — who decides the device name.** *The user, on first registration, with a sensible default.*
  Rename lives in `Settings → Threads → Devices` (out of this card).
- **Q7 — what the local shadow looks like.** *One `~/.weft/vault/<hash>.sync.json` per shared vault,*
  alongside the existing `.json`. The local file keeps its shape.
- **Q8 — the rename path.** *Out of v1.* The drawer surfaces the orphan and offers a manual export in
  v1.1.
- **Q9 — conflict UX on a thread-generated value.** *The thread re-reads; a `filled: true` on a row
  that is no longer a blank is the same answer the user would have got.*
- **Q10 — adding a second device to one's own account.** *Same TOFU flow, but the pending row's
  `target_user_id` is the actor.*
- **Q11 — rotate when only one device is online.** *Per-vault, with a checkbox list.* No-op on a vault
  the removed user had no grants on.
- **Q12 — removing a single device, not the user.** *Same rotate path, scoped to the device's grants.*
- **Q13 — which vaults get a recovery key.** *Every shared vault by default.*
- **Q14 — live event log on the drawer.** *Yes, Realtime.*
- **Q15 — the user is the only member of the org.** *The personal workspace's vault is local-only; the
  "Share with …" button is hidden.*
- **Q16 — does a read require a network.** *No. The shadow has the ciphertext; the unwrap is local.*
- **Q17 — where a vault the local Weft doesn't have lives in the UI.** *`Settings → Threads → Vaults`,
  a one-list page.*

## Test files added

`electron/account-client.test.ts`, `electron/device-fingerprint.test.ts`,
`electron/vault-sync.test.ts`, `electron/vault-grant.test.ts`,
`electron/vault-rotate.test.ts`, `electron/vault-recovery.test.ts`,
`lib/team-devices-view.test.ts`, `components/VaultParts.test.tsx`,
`components/VaultEventsList.test.tsx` (both new — the drawer's parts have no test file of their own
today), `components/SecretRow.test.tsx` and `components/VaultDrawer.conflict.test.tsx` (the
conflict banner, and the drawer that shows it), and `lib/use-vault-conflicts.test.ts` (the transient
conflict state). The
migration is hand-tested against a fresh `supabase db reset`; the route tests in
`app/api/routes.test.ts` cover the new `app/api/team/devices*` routes.
