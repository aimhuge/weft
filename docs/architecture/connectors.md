# Connectors

Settings → Connectors lists outside services your threads can work in. Each one is a CLI that Weft
ships or finds on PATH. Threads call it from Bash, and Settings handles the sign-in. Connectors are
different from the rail drawers (GitHub, Supabase, Vercel, Cloudflare, Slack, BlastCP): a drawer links a
**project** to a service and keeps its tokens in the Keychain, while a connector gives every thread
access to one of **your** accounts.

## Google Workspace (gog)

[gog](https://github.com/steipete/gogcli) is a single Go binary covering Gmail, Calendar, Drive, Docs,
Sheets, Slides, Contacts, Tasks, Forms and more, with `--json` output for scripts.

| Piece | Where |
| --- | --- |
| Shipped binary | `scripts/bundle-toolchain.mjs` `installGog()`: downloads `gogcli_<GOG_VERSION>_<os>_<arch>.tar.gz` from the GitHub release, refuses it unless the sha256 matches `GOG_SHA256`, unpacks to `toolchain/gog/gog`, wrapper `toolchain/bin/gog` |
| Status and actions | `lib/gog.ts` (types in `lib/gog-view.ts`): `gogStatus()`, `setGogCredentials()`, `addGogAccount()`, `cancelGogAdd()`, `removeGogAccount()` |
| Route | `app/api/connectors/gog/route.ts`: GET status, POST `{action: credentials \| add \| cancel \| remove}` |
| UI | `components/SettingsConnectorsPage.tsx` → `components/GogConnector.tsx` |
| Threads | `GOG_PROMPT` in `lib/gog.ts`, pinned in `lib/weft-prompts.ts` |

How a sign-in works:

1. **OAuth client.** gog needs a Google Cloud OAuth client (Desktop app). Weft.app ships one of its own
   (`WEFT_CLIENT = "weft"`), so a released build signs in with no setup: **Sign in with Google** stores
   Weft's client in gog under that name and uses it. The client id and secret come from the 🔐 vault in
   development and are baked into a release build; an installed app's client secret isn't confidential to
   Google, but it stays out of git. When a build carries no client of its own, the user creates one in the
   console, downloads its JSON and picks it in the card. The file's text goes to `gog auth credentials set -`
   on stdin, so Weft never writes it to disk and no thread sees it; gog stores it in its own config.
   A user's own client always wins over Weft's, so a user who brought their own keeps it.
2. **Account.** **Sign in with Google** runs `gog auth add <email> --client <name>` (with `--readonly` when
   that's ticked). gog opens the browser on Google's consent page and listens on localhost for the redirect.
   The card polls every 2 s while `adding` is set and gives up after 5 minutes (`ADD_TIMEOUT_MS`). The
   refresh token goes to gog's keyring (macOS Keychain).
3. **Threads.** `GOG_PROMPT` tells every thread to find accounts with `gog auth tokens list --json` (never `auth list`, see below), pass `-a <email> --json`,
   and confirm before sending mail, changing events or sharing files.

The status carries two client flags: `weftClient` (this build carries Weft's own client) and `ownClient`
(the user chose one of their own). `weftClient && !ownClient` is what puts the user's own client behind a
quiet link instead of in front of the sign-in form.

**No Keychain prompts.** Status never opens a token. Accounts come from `gog auth tokens list --json`, which names
each token (`token:<client>:<email>`) without opening it, and the OAuth client comes from `auth credentials list`.
`gog auth list` and `auth status` decrypt tokens, and when the gog asking isn't the one that stored them (Homebrew's
vs Weft's own copy), macOS asks for the login password on every read. Only Sign in and Remove touch the keyring.

The version: `GOG_VERSION` lives in both `lib/gog.ts` and `scripts/bundle-toolchain.mjs`, and
`lib/gog.test.ts` checks they match. The toolchain sits at the end of PATH, so a gog the user installed
(Homebrew) wins. When that copy is older than the shipped one, the card says so and hides Read-only,
which older gogs don't support.

## Simulators

Not an account but local tools: the **Simulators** card checks Xcode, an iOS runtime, AXe, the Android SDK, adb,
the emulator and an AVD for the `mcp__simulator__*` tools, and shows the command or link that fixes each missing
one. It never installs anything. Details in docs/architecture/simulators.md.

## Next connectors

Same shape each time: a CLI threads can call, a card in Settings for its sign-in, and a short pinned
prompt (or a skill) that teaches threads to use it. Candidates are tracked in docs/ROADMAP.md
under Integrations.
