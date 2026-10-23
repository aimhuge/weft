# Secrets

Status: steps 1 (guardrails) and 2 (device key and local vault) built 2026-10-11; step 3 (agent tools, dev-server
injection, redaction) built 2026-10-12 except `request` and values for HTTP requests; the rest is design.

Weft keeps two kinds of secrets apart:

- **Weft's own**: the Supabase service-role key, the database password, the GitHub and Google OAuth client
  secrets. They live only on the server side (Supabase and the host's environment) and never ship in the
  desktop app. The app carries only the publishable key (`lib/account.ts`); row-level security guards the data.
- **Yours**: your projects' `.env.local` values and their Vercel environments. Weft keeps them in its own
  vault, end-to-end encrypted, so they can be shared with a team later without Weft's servers ever
  reading them, and pushes them to Vercel from your machine.

## The one rule

A secret's **value** never enters an agent's context. Once a thread has seen a value, it's in the model
request, in `~/.claude/projects/*.jsonl` and `~/.weft/threads/` (plaintext, forever), in the search index,
and possibly in pane pages, review tours and commits. Threads work with **names**; Weft puts **values**
in at the edge: a dev server's environment, a Vercel API call.

## Keys (built for teams from day one)

Envelope encryption, the same shape as 1Password or Bitwarden. Working solo is a one-member team:

```
device keypair (X25519)     private key in the macOS Keychain via Electron safeStorage; public key in Supabase
        │ wraps (sealed box)
vault key (256-bit, random) one per vault, versioned; a "grant" row holds it wrapped for each member device
        │ encrypts (XChaCha20-Poly1305, AAD = vault id + name + environment + key version)
secret values               ciphertext rows in Supabase, never plaintext anywhere off your machine
```

- **A vault per project**, identified by its GitHub repo (`owner/name`, read from `git remote`).
  Because sign-in is GitHub, a teammate who clones the same repo finds its vault.
- **Adding a device or a teammate**: a device that already has a grant wraps the vault key to the new
  device's public key. Supabase only hands over public keys, so the new key's fingerprint is shown on both
  screens to compare (trust on first use, like Signal's safety numbers). Otherwise a compromised server could
  slip in its own key.
- **A recovery key** (shown once, for a password manager or paper) gets its own grant, so losing every
  device doesn't lose the vault.
- **Removing someone**: rotate the vault key (new version, re-encrypt, re-grant everyone else) **and** list
  every secret they could read as "rotate at the provider". They had the plaintext; no re-encryption takes
  that back.
- Crypto via `libsodium-wrappers` (sealed boxes, XChaCha20), not hand-rolled on `node:crypto`.

## Tables (Supabase, all with row-level security)

| table | holds | who can read |
|---|---|---|
| `devices` | user, name, public key, revoked_at | members of a shared vault (public keys only) |
| `teams`, `team_members` | team, user, role (owner/admin/member) | members |
| `vaults` | team or personal owner, repo, current key version | members |
| `vault_grants` | vault, device, key version, wrapped key | that device's user only |
| `secrets` | vault, name, environment (development/preview/production), ciphertext, nonce, key version, version, updated_by | members (ciphertext only) |
| `secret_events` | vault, name, actor, action, time: append-only, no values | members |
| `vercel_links` | vault ↔ Vercel project and team id (no token) | members |

RLS decides who can fetch ciphertext; encryption decides who can read it. Supabase never holds a key that
opens a vault. Writes use a `version` column for optimistic concurrency, so two people editing the same
secret get a conflict instead of one silently overwriting the other.

## Where code runs

- **Electron main process** holds the device private key, unwraps vault keys and decrypts. The board talks
  to it over IPC (`electron/preload.cjs`). Plaintext never goes through a Next API route.
- **The Next server's environment reaches every agent**: `cliEnv()` (`lib/env.ts`) copies `process.env`
  into each CLI, minus Weft's own `WEFT_SHELL_*` keys, anything named like a secret (`*_KEY`, `*_TOKEN`,
  `*_SECRET`, `PASSWORD`, `*_DSN`, `DATABASE_URL`…) and any value shaped like a key (`lib/secret-detect.ts`).
  `ANTHROPIC_*` and `PUKU_*` stay, since the CLIs sign in with them. A command that needs a value gets it
  from the vault through `mcp__secrets__run`.
- **The control server's token isn't in any env.** Main writes it to `~/.weft/shell-token` (0600, new each
  launch, deleted on quit; `electron/shell-token.cjs`) and the server reads it from there (`lib/shell-token.ts`).
  An env is readable by any process of yours (`ps eww`); the file sits behind the secret guard like a `.env`.
- **Dev servers** (`lib/devserver.ts`) get the vault's development values in their env; agent shells don't.
- **Vercel push** runs on your machine with your own Vercel token (Keychain). The ▲ drawer lines the vault's names up
  with the linked project's (on Vercel, vault only, Vercel only, per environment), and every push is its own Touch ID,
  from the drawer or from a thread (`mcp__secrets__push_to_vercel`); the value goes from the vault to Vercel inside main
  (docs/architecture/vercel.md).
  The 🔐 drawer shows the same link on each vault (`components/VaultVercel.tsx`): the project, how many values are
  still to push, and **Push to Vercel** (Push all, one Touch ID); nothing for a folder that isn't linked.

## Where you find it: the left rail

The vault is a 🔐 icon on the left rail (`SideRail` in `components/LibraryRail.tsx`), under ★ and 🏷 and separated by a
divider. It adds no new row: its count badge carries the nudges ("3 missing", or a dot when `.env.local`
holds values not yet imported). It opens the same drawer the library uses (sliding out from under the board, which
lies on it as a sheet), with every board project's vault. A project filter at its top follows the top bar's project;
picking another there holds until the top bar's project changes (`vaultFilter` in `lib/vault-view.ts`). Under it a
search box (`components/VaultSearch.tsx`, `lib/vault-search.ts`) keeps the secrets whose name or blank hint holds every
word typed, and hides the projects with no match; Escape clears it. The
rail's badge counts the top bar's project only.

- **The drawer**: names grouped by environment (development / preview / production), masked tails, an
  Add button (also Shift+`S` and the palette's "Add a secret": `addSecret()` in `lib/use-vault.ts` opens the drawer and the drawer's `onSecretAsk` taker opens the form on the first vault shown, once it has loaded) (name, environment and a hidden value, typed into the board and sent once to main, so projects
  with no `.env` file get a vault too), ✎ / Change Value… / Fill in for a new value, with the environments left open (`Editing.from` is where it started: tick others to save it there too, untick `from` to move it, the old copy removed after the new one is written; a blank moves with no value; `saveLabel` says Save, Move to … or Save to N environments), Copy to <project> in the right-click
  menu (one item per other project, since menus have no submenus; main decrypts and re-encrypts across, so
  the value never reaches the board), a 🎲 in the form's value field (`components/SecretValueField.tsx`) that fills in `randomSecret()` from `lib/random-secret.ts` (40 letters and digits from `crypto.getRandomValues`, rejection-sampled), an Import button, a Vercel diff ("2 not on preview"), and, once teams arrive, members and the event log.
- **Revealing or copying a value asks for Touch ID** (`systemPreferences.promptTouchID`); the drawer
  locks again after a few idle minutes.
- **The vault's IPC bridge goes only to the board window**, never to browser-pane pages
  (`electron/browser-pane.cjs`): pane pages are agent-driven and can be any site.

## Importing `.env` files

Most projects already have their secrets in `.env.local`, so that's how a vault gets started.

- **Main reads the file**, not an agent: `fs` plus a dotenv parser in Electron main, so values go from the
  disk straight into the vault. It handles quotes, multiline values, `export` prefixes, and stores
  `${VAR}` references as written.
- **The file name sets the environment**: `.env.local` and `.env.development.local` → development,
  `.env.production.local` → production. `.env` holds shared defaults (often committed); it's offered but
  left unticked. `.env.example` brings in **names only**, which show as "missing" until filled.
  Monorepos: scan `apps/*` and `packages/*` too.
- **Preview before anything is written**: each name, masked tail, and new / same / differs from the vault,
  each with a checkbox. `NEXT_PUBLIC_*` gets a "public" tag (it ends up in the browser bundle anyway).
  Files written by `vercel env pull` (`# Created by Vercel CLI`) skip short-lived values like
  `VERCEL_OIDC_TOKEN`.
- **Nudge**: a dot on the rail's 🔐 when a project has a `.env.local` that isn't in the vault; the drawer says "Found 14 secrets in
  .env.local: move them into the vault?"
- **Committed file?** If git tracks the `.env` file (`git ls-files`), warn loudly: those values are in
  history, so rotate them at the provider instead of just importing.

### After import: the file stays, managed by Weft

`next dev`, Prisma, the Supabase CLI and scripts you run yourself all read `.env.local` directly;
injecting values only reaches processes Weft starts. So the vault stays the source of truth and
**Weft writes `.env.local` back out** with a `# Managed by Weft` header (gitignored, mode 0600, agents
denied). A file watcher notices hand edits and offers "Import changes", so editing the file still works.
(Decided 2026-10-11: keep the file. A no-file "strict mode" is out of scope for now.)

## What agents get

- `mcp__secrets__list` (built): names, environments and whether each is missing, for the card's folder or another
  project by path. Never values, not even tails.
- `mcp__secrets__fill_field(name, selector, environment?, project?)` (built): Electron main types the value into a
  field on the card's pane page. The thread never sees it. How:
  - `lib/secret-tools.ts` calls the pane's control server (`POST /secrets/fill`); `electron/pane-secrets.cjs` refuses
    anything but https, then asks `vault.useFor()`.
  - `useFor` asks for Touch ID ("let a thread type NAME (owner/repo) into site"). Approvals are their own, one per card,
    site and vault, open for `UNLOCK_MS` from the last use: the drawer being unlocked never lets a thread in, and a yes for
    one site never covers another. Lock clears them.
  - The pane types the value (`electron/pane-actions.cjs`), masks the field with `-webkit-text-security` so screenshots
    don't show it, and `read_page` swaps the value for `‹NAME›` in the page's text and title.
  - The tools are trusted (`isTrustedTool`): Touch ID is the one yes, with no permission prompt before it.
  - Limits: a page's own script can still read a field it was given (that's what the field is for), so the https rule
    and the site in the Touch ID prompt are the guard against a thread filling a page it controls.
- `mcp__secrets__ask_add(name, environment?, project?)` (built): a key the thread is blocked on right now. The name goes
  in as a blank, and the thread shows an input for it in place of the tool call (`components/SecretAskInput.tsx`): the
  name, its environments and a hidden value field with the cursor in it, so the user pastes the value where they're
  already reading (a drawer would open behind the thread panel). **Add to vault** hands the value to main through the
  board's own `vault.set` IPC, then sends the thread "I added NAME (env) to the 🔐 vault." as the user's message; once
  the vault holds it the input folds to a ✓. The thread is told to end its turn after the call and wait for that message.
  `lib/runner-turn.ts` marks the tool item with `ask` (`secretAskOf` in `lib/vault-view.ts`), `groupThread` keeps it out
  of the folded tool run, and `ThreadEntries` draws it. `fill_field` and `run` put every missing name in as a blank and
  point the thread at `ask_add`. `lib/secret-ask.ts` posts `POST /secrets/ask-add`, which only adds the blank. Outside
  the board window (no vault bridge) the input says to use 🔐 on the rail. No value passes through the thread either way.
- `mcp__secrets__add_blank(names[], hint?, environment?, project?)` (built): the default for a key a thread needs
  but isn't blocked on. The thread calls this as soon as it knows the name (with a hint for where to get the
  value: the dashboard path plus its direct https link, up to 400 characters), keeps going with what doesn't need the value, and the user fills the blanks in from 🔐 on the rail
  when they're ready — a name already filled in keeps its value. Nothing opens; the value never comes back.
  Posts `POST /secrets/add-blank` (`electron/vault-routes.cjs`); main calls `vault.addBlanks(folder, names, [env], { source, hint })`
  (`electron/vault.cjs`). The drawer's `SecretRow` (`components/SecretRow.tsx`) shows a visible **Fill in** button on
  every blank row with the hint under the name, in full: the name wraps after an underscore (`<wbr>`) instead of
  being cut off, and every https link in the hint (`hintParts` in `lib/hint-links.ts`) opens in the browser pane
  (`lib/open-in-pane.ts`, falling back to the system browser), where the user is signed in; blanks sort first within each environment, the rail's badge counts
  them, and the plain Add form's button reads **Add blank / Add N blanks** with the same flow. Older shells without
  `addBlank` keep the "type a value" form.
- `mcp__secrets__set_value(name, value, environment?, project?)` (built): a value the thread generated itself (a
  32-byte signing secret, a webhook secret it made up) into a name it already put in as a blank. Posts `POST /secrets/set`
  (`electron/vault-routes.cjs`); its `fillBlank` answers `missing` when the name isn't a blank in
  that environment ("Call add_blank first") and `filled` when it already has a value, so a thread can't overwrite one the
  user put in; otherwise it asks Touch ID every time through `vault.confirm` (never the thread unlock cache: it's a write)
  and stores it through `vault.setValue`, ciphertext in a 0600 file. The answer is `{ ok, label }` and the thread is told "Set NAME in the VAULT vault
  (env)"; the value is never echoed or logged. It did pass through the thread's context once, as the tool's input, since the
  thread made it: keys the user gets from a provider stay blanks for them to fill in.
- `mcp__secrets__run(command, why, names, environment?, cwd?, timeout_seconds?, project?)` (built): a command with vault
  values in its env, for a thread that never sees them. The motivating case: `DATABASE_URL` is in the vault and a thread
  runs `npm run job` or a migration.
  - The Next server (`lib/secret-run.ts`) checks the command (`lib/secret-command.ts`) and splits it into argv; it never
    holds a value. One plain command only: anything a shell would read outside single quotes (`|`, `>`, `;`, `&&`, `$VAR`,
    `$(…)`, backticks) is refused, since main runs it with no shell. Also refused: shells and `eval`, wrappers that run
    another command (`env`, `sudo`, `xargs`), env dumps (`printenv`), network tools (`curl`, `wget`, `nc`, `ssh`), inline
    code (`node -e`, `python -c`, `perl -pe`, `awk`, `npx -c`), and setting a vault name on the command line.
  - For `npm run X` (and `pnpm`, `yarn`, `bun run`) it reads `package.json` so the approval shows what really runs,
    with `preX` and `postX`.
  - Electron main (`electron/secret-run.cjs`) gets the values (`vault.valuesFor`, main only, never over IPC) and asks:
    a dialog (`electron/approval-window.cjs`) naming the asking card by its title, the thread's own one-line `why`, the
    command, the folder, the script and the names (Cancel / Allow once / Always allow), then Touch ID. The title and
    `why` are only shown, never part of a remembered rule; a dev server's approval names its card too.
    *Always allow* is a rule in the data folder's `vault/run-rules.json` (`electron/run-rules.cjs`), sealed with
    safeStorage so a thread can't write one. It pins the vault, environment, folder, exact command and a hash of the
    script, and covers those names or fewer, so a thread editing the script makes it ask again. A `run` rule also
    pins a fingerprint of the folder's tree (`treeFingerprint`: HEAD, `git diff HEAD`, untracked files' bytes), so
    editing any code the script runs makes it ask again too, and outside a git repo Always never holds. `dev` rules
    don't pin the tree, so a dev server restarting while you edit doesn't re-ask.
  - Main spawns argv detached with no shell, its own env minus `WEFT_SHELL_*`, plus the values; a timeout
    (default 2 minutes, at most 10) sends SIGTERM to the process group, then SIGKILL. Output is redacted
    (`electron/secret-redact.cjs`), then cut to the last 20,000 characters, and comes back with the exit code.
- Redaction (`electron/secret-redact.cjs`, built): each value and the forms programs print it in, swapped for
  `‹NAME›`: as written, JSON-escaped, URL-encoded (`%20` or `+`, either hex case), base64 and base64url, including
  base64 of the value inside a longer string (the three byte alignments). Values under 4 characters are left alone.
- Dev servers (built): `lib/devserver.ts` asks main for a one-time grant of the folder's development values
  (`POST /secrets/dev-grant`, approved like a run, *Always allow* as a `dev` rule). It starts `electron/secret-env.cjs`
  with Electron as node and writes the control-server token, the grant and argv to its **stdin**, so neither sits in a
  process's environment. The wrapper claims the values (`/secrets/claim`, once, within a minute), runs the command
  with no shell, and redacts its output line by line. A command the policy refuses, a no or no vault starts the server
  the plain way, with a note in its log. Dev servers no longer inherit the control-server token either (`cliEnv()`).
- Stored results (built): main remembers the values each card used (a run, a fill, a dev server). `lib/runner.ts` sends
  that card's tool results through `POST /secrets/redact` before writing them to Weft's thread files (and so the search
  index); if main can't answer, the result is stored as "output hidden". Limits: the model saw the result as it was,
  the CLI's own transcript in `~/.claude/projects` keeps it, and the model's reply text isn't redacted.
- Not built: `mcp__secrets__request(name, environment, why)` (the card moves to *Needs you* with a paste field), values
  for HTTP requests (a header), a list of remembered approvals in the drawer, and patterns like `npm run job:*`.
- A PreToolUse hook (`lib/secret-guard.ts`, on every thread and the refactor scout) denies reading `.env*`
  (except templates like `.env.example`), `~/.weft/account.json`, the device key and the vault files. It's a
  hook, not `canUseTool`, because reads never ask, and `bypassPermissions` skips `canUseTool` entirely.
  - Files: `Read`, `Edit`, `NotebookRead`, `Grep` (by path or glob, so `*.local` counts too), and the browser
    pane opening a `file://` URL to one.
  - Bash: commands go through a shell parser (`lib/shell-parse.ts`) that follows quotes, escapes, heredocs,
    redirects, `$(…)`, `sh -c`, `eval`, `xargs` and `find -exec`. A command is turned away only when it is the
    one reading the file: `cat .gitignore | grep .env` runs, while `cp .env.local x` and `cat .e*` don't.
  - Code: `sed -e`/`grep -e` scripts and an interpreter's inline code (`python3 -c`, `node -e`, a heredoc) may
    mention `.env` freely; code is turned away only when it opens one (`open(…)`, `readFileSync(…)`, `Path(…)`,
    `subprocess.run(…)`, Ruby/Perl backticks, or a variable set to the path when the code opens something).
  - Dumps: `printenv`, bare `env`/`export`/`set`, `ps e`, `console.log(process.env)`, `print(os.environ)`,
    `echo $SOME_KEY`, and `vercel env pull` to stdout.
- Paste guard in the Composer (`components/SecretPaste.tsx`): a paste that looks like a key (`lib/secret-detect.ts`)
  waits in a strip until you paste it anyway or drop it. A key that arrives any other way (typed, dictated,
  dropped in) shows the same strip as the message changes, with Remove it and Keep it.
- Commit scan: the pre-commit hook runs gitleaks, or without it `scripts/secret-scan.mjs`, which checks each
  added line against the same key shapes (test files and `gitleaks:allow` lines skipped).

Limit: an agent with unrestricted Bash can still print the env of a process it can reach, or write a script
that opens the file itself (`~/.weft/shell-token` included). This is a strong default, not a sandbox. Known gaps
(rechecked 2026-10-12):
- The env strip goes by names and known key shapes; a secret under a plain name (`MY_APP_CONFIG`) with an
  unusual shape still reaches threads.
- Without gitleaks the commit scan knows only the key shapes in `lib/secret-detect.ts`. CI pins gitleaks but
  hasn't run yet.

## Already exposed today

- Fixed 2026-10-12: the Supabase session, refresh token included, is `~/.weft/account.sealed`, encrypted by
  safeStorage in Electron main (`electron/account-store.cjs`). The Next server reads and writes it through main's
  token-guarded control server (`POST /account/read` and `/account/write`, `lib/account-storage.ts`); an old plain
  `account.json` moves in on first read and is deleted. Outside the desktop app (`pnpm dev` in a browser) there's
  no main, so it's still the plain file there.
- Fixed in step 1: the secret guard turns away a thread's `cat .env.local`.

## How step 2 is built

- `electron/env-writeback.cjs`: the import preview offers "Then let Weft write .env.local from the vault" when the
  project has a `.env.local` Weft doesn't write yet. `vault.writeBack(folder)` refuses a file git tracks, or one
  holding a value the vault doesn't (import it first); otherwise it adds `.env*.local` to `.gitignore` if git doesn't
  ignore it, and writes the development values under a `# Managed by Weft` header (mode 0600, renamed into place;
  names still missing are comments). From then on every change to that vault (add, import, copy, remove) rewrites
  every managed `.env.local` of its folders. A watcher on the folder (not the file, which each write replaces) sends
  `vault:changed` to the board when the file changes into something Weft didn't write, and the nudge reads "You
  edited .env.local: import the change into the vault?". A line you delete by hand comes back at the next rewrite.

- `electron/vault-crypto.cjs`: libsodium. `newKeypair` (X25519), `newVaultKey`, `wrapKey`/`unwrapKey` (sealed
  boxes), `encrypt`/`decrypt` (XChaCha20-Poly1305 with `aad(vaultId, name, environment, keyVersion)`).
- `electron/device-key.cjs`: `~/.weft/device-key.json` holds the public key and the private key encrypted by
  `safeStorage`; with no safeStorage, Weft refuses instead of writing the key in the clear.
- `electron/vault-store.cjs`: one `~/.weft/vault/<hash of id>.json` per vault (mode 0600): the key version, a
  grant per device (the vault key sealed to it), and entries with ciphertext, nonce and key version. A name from
  `.env.example` is an entry without ciphertext ("missing"). `list` returns names and 4-character tails only.
- `electron/dotenv.cjs`: the parser and the file rules (which file feeds which environment, names-only
  templates, Vercel pulls). `electron/vault.cjs`: the vault id from `git remote` (`github:owner/name`, or
  `folder:<path>`), the overview with the nudge, the import preview, `importPicks` (which reads the files again
  in main, so values never pass through the board), `setValue` (a typed secret; checks the name) and `copyTo`
  (vault to vault, in main), reveal and copy behind `createUnlock` (Touch ID, open for 3
  minutes from the last use), and `registerVault`, whose IPC handlers refuse any sender but the board's
  webContents.
- The board: `window.weft.vault` (`electron/preload.cjs`), `lib/vault-view.ts` (what the drawer shows),
  `lib/use-vault.ts` (loads on folder change and window focus; `useIdle` locks after 3 idle minutes), and
  `components/VaultDrawer.tsx` (its row, form, filter and import preview in `components/VaultParts.tsx`)
  inside the library drawer's shell in `components/LibraryRail.tsx`.

## Build order

1. **Guardrails** (no backend needed): the secret-guard hook, the env strip in `cliEnv()`, gitleaks
   in Weft's own pre-commit hook and CI, the Composer paste guard. Built; audited 2026-10-11.
2. **Device key and local vault** (built 2026-10-11): keypair in the Keychain, the vault in main, a Secrets panel per
   project, `.env` import with preview and nudge. Finished 2026-10-12: `.env.local` written back with a watcher for
   edits (`electron/env-writeback.cjs`), and the refresh token moved behind `safeStorage`.
3. **Agent tools, dev-server injection, redaction.** Built 2026-10-12: `list`, `fill_field`, `run`, dev-server injection,
   redaction of stored tool results. Still open: `request`, values for HTTP requests, the approvals list in the drawer.
4. **Supabase sync**: the tables above with ciphertext only, multi-device grants, recovery key.
5. **Vercel push** (built 2026-10-12): names diff per environment, push per name with Touch ID, from the drawer or a
   thread. Pull built 2026-10-13: plain Vercel variables the vault has no value for come down, by hand or live through a
   team webhook (docs/architecture/vercel.md). Still open: "changed" (needs Vercel's values).
6. **Teams**: invites, fingerprint check, roles, rotate-on-remove, the event log in the panel.
