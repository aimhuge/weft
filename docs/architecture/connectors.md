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
| UI | `components/SettingsConnectorsPage.tsx` → `components/GogConnector.tsx` (the panel's status and poll: `lib/use-connector-status.ts`) |
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

**Google's review.** Weft's own client lives in Google Cloud project `weft-512507` (Desktop app, External, in Testing, up to 100 test users whose sign-ins expire after 7 days). Its consent screen links `weft.zip`, `/privacy` and `/terms`; `app/privacy/page.tsx#google` states the Limited Use terms the review reads. Taking it out of Testing needs brand verification and a CASA assessment for the restricted scopes (`drive`, `gmail.modify`, `gmail.settings.basic`, `gmail.settings.sharing`).

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

## Connectors on a worker: GitHub (P1, as built)

Built 2026-11-02 with `supabase/migrations/20261102280000_worker_github_mint.sql` (not applied), from the design note
"Lending connector sign-ins to a Weft Worker" (rev. 4) and the T2 red team ([project-hosts.md](project-hosts.md#connectors-on-a-worker-github-p1-as-built)).
A card on a paired Weft Worker can push, open pull requests and use `gh` **as you, with Weft**, through GitHub App user
access tokens that weft.zip mints and refreshes. Nothing long-lived reaches the box: your refresh token and the app's
secrets stay on weft.zip, and what a card gets is a short user token. Unit-tested on every side; not yet run against
GitHub or a live worker (the app isn't registered yet).

```
connect (once):  Settings → Devices → a worker → Connectors → Connect GitHub ─ browser pane ─ weft.zip/api/connectors/github/start
                 (your weft.zip session; state + PKCE verifier in an httpOnly cookie) ─ GitHub consent ─ /callback ─ code + verifier
                 ─ ghu_ (8 h) + ghr_ (6 months) sealed with WEFT_CONNECTOR_TOKEN_KEY ─ connector_github_tokens (service role only)
turn on (once per worker):  Turn on ─ window.weft.connectors.set ─ main: Touch ID "let the worker m1mini use GitHub as you, with
                 Weft" ─ connector_grants row through main's own session (RLS: yours, a paired worker of yours)
a card's git/gh: git credential helper / scripts/worker-bin/gh ─ scripts/weft-connector-helper.cjs ─ ~/.weft-worker/connector.sock
                 (lib/connector-socket.ts: the session's capability → its card; the repo from the card's own origin)
                 ─ lib/connector-client.ts: {worker, card, connector, repo, ts, nonce} signed with sign-key.json, Bearer wwk_
                 ─ weft.zip/api/connectors/github/mint (lib/connector-mint.ts) ─ token + expiresAt, held in the daemon's memory
turn off / revoke:  DELETE /api/devices/connectors?worker= ─ weft.zip/api/connectors/github/revoke ─ grant deleted, tokens ended
                 at GitHub, what GitHub confirmed shown on the row
```

### Registering the Weft GitHub App (one go)

At [github.com/settings/apps/new](https://github.com/settings/apps/new) (or the org's
`github.com/organizations/<org>/settings/apps/new`):

| Field | Value |
| --- | --- |
| GitHub App name | Weft (its slug makes the install link `github.com/apps/<slug>/installations/new`) |
| Homepage URL | `https://weft.zip` |
| Callback URL | `https://weft.zip/api/connectors/github/callback` (add `http://localhost:5001/api/connectors/github/callback` for a local `WEFT_WEB=1` server) |
| Expire user authorization tokens | **On** (required: the callback refuses a token with no refresh token, so a token that never expires is never handed out) |
| Request user authorization (OAuth) during installation | Off (connecting is its own step on weft.zip) |
| Enable Device Flow | Off |
| Webhook | Active **off** (P1 needs none) |
| Repository permissions | **Contents: Read and write**, **Pull requests: Read and write**, Metadata: Read-only (added automatically). Nothing else: no Administration, Workflows, Secrets or Actions |
| Account permissions | none |
| Where can this app be installed | Any account (so you can install it on an org's repos too) |

Then on the app's page: note the **App ID** and **Client ID**, **Generate a new client secret**, and **Generate a private
key** (a `.pem`). Put them in the 🔐 vault for the weft project, production: `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`,
`GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, plus `WEFT_CONNECTOR_TOKEN_KEY` (64 hex chars, `openssl rand -hex 32`),
and push each to the Vercel project (`mcp__secrets__push_to_vercel`). P1 uses the client id and secret and the token
key; the app id and private key are for the `weft[bot]` installation tokens a later phase may add. Finally **Install
App** on the repos you want workers to reach ("Only select repositories"): a user token reaches only repos the app is
installed on that you can also reach.

### What weft.zip holds and checks

- **`connector_github_tokens`**: one row per user, the refresh token and the current access token, each sealed with
  AES-256-GCM bound to the user and the field (`lib/connector-crypto.ts`). RLS on, no policy, no grant: only the service
  role reads it.
- **`connector_grants`**: one per (you, worker, connector) with `scope`, `approval`, `lifetime` and `asks`, made, changed
  and deleted only by your own session (RLS, and only for a paired worker of yours that isn't revoked). The database sets
  `created_at` and `expires_at` from the lifetime (restarting it when the lifetime changes). A worker revoked by
  `device_revoke` loses its grants in a trigger.
- **`connector_allows`**: the project or card Allows that per-project and per-card approval need.
- **`connector_mints`**: the ledger, every answer to a worker, readable by you ("last used" and the waiting Allows in
  Settings come from it). Its `unique (worker_id, nonce)` is the replay check.
- **`connector_live_tokens`** and **`connector_cards`** (service role only): narrowed tokens handed out, so a revoke can
  delete them at GitHub; and the cards a mint has checked you started, since start commands expire after a day.

The mint (`lib/connector-mint.ts`) decides from those rows, never the worker's word: the `wwk_` key (sha256 against
`cloud_workers.key_hash`), a signature by the worker's Ed25519 sign key over every field (`cloud_workers.sign_key`, set
only by `worker_pair_confirm` under your Touch ID; a token-enrolled worker has none and gets nothing), a timestamp within
2 minutes, a nonce logged once, at most 30 asks a minute and 300 an hour per worker; then a live grant; then a card
**you started**: a `new_card`, `run` or `card.create` command you created for that worker and card (T2's
`createCardOrigins` rule, so a reply or an H6-line verb can't stand in for one), pinned on first use; the repo the card's
start named (a run's git URL, or the folder's name for the repo asked); the card not Done or deleted; and, under
per-project or per-card approval, an Allow for it (else 403 with `needs: "allow"` and the ledger says `needs_allow`, which
puts an **Allow** button in the worker's Connectors menu, behind Touch ID).

### Tokens: what GitHub does, and what Weft does with it

Checked against GitHub's docs on 2026-11-02:
- a user access token (`ghu_`) lives **8 hours** and its refresh token (`ghr_`) **6 months** while the app's token expiry is
  on (`expires_in` 28800, `refresh_token_expires_in` 15897600);
- refreshing (`grant_type=refresh_token`) returns a new pair, and "that refresh token and the old user access token will
  no longer work";
- `DELETE /applications/{client_id}/token` revokes **one** token, and applies to GitHub App user tokens (`ghu_`);
  `DELETE …/grant` deletes the whole authorization and every token; both take Basic auth with the client id and secret
  and answer 204;
- `POST /applications/{client_id}/token/scoped` makes a user token narrowed to named repositories and permissions;
- a user token reaches only what both you and the app's installations reach; PKCE (`S256`) is supported in the web flow.

So (`lib/connector-tokens.ts`): there's one chain per user. A token is handed out with `expiresAt = issued + 1 hour`; every
holder stops using it 2 minutes before that, and weft.zip refreshes only after that point, so a rotation never kills a
token a worker still trusts, and each refresh ends the token before it. Two mints at once don't both spend the refresh
token: one claims `refreshing_until` and the other waits for its answer. **Scope** "all installed repos" hands out that
user token. "This project's repo" and "the card's repo" hand out a **scoped user token** for that one repo, with
contents and pull-request write and metadata read, still as you; it's kept per project or card, reused while young and
while its parent is still the current token, and deleted at GitHub when it's replaced. This differs from the design
note, which planned `weft[bot]` installation tokens for the narrow scopes because it assumed user tokens can't be
narrowed; GitHub's scoped-token endpoint keeps the identity "as you". Not in GitHub's docs, and so assumed until a live
run: how long a scoped token lives (the answer's `expires_at` is stored when given), and whether refreshing its parent
ends it (Weft never hands one out again once its parent has rotated, so either way is safe).

### On the worker

`lib/connector-worker.ts` starts with the daemon (`scripts/weft-worker.ts`), only on a paired box. It reads the box's own
`credential.https://github.com.helper` entries and the real `gh`, opens `~/.weft-worker/connector.sock` (mode 600) and
sets what every CLI session's env gets (`lib/connector-env.ts`, from `lib/runner-session.ts` and `lib/codex-runner.ts`):
the socket's path, a random capability per session (a warm spare too; it resolves to the session's card when asked),
`scripts/worker-bin` first on PATH, and `GIT_CONFIG_*` entries that reset git's helpers for `https://github.com` and put
Weft's first, then the box's own (so a pasted `github_login` token still works where GitHub isn't turned on). No token
is in that env.

- **git** runs `scripts/weft-connector-helper.cjs git-credential get` (through `env -u NODE_OPTIONS -u NODE_PATH`), which
  asks the socket and prints `username=x-access-token`, the token and `password_expiry_utc` on stdout to git. `erase`
  drops the daemon's copy.
- **gh** is `scripts/worker-bin/gh`, the same helper's `gh` mode: it refuses `auth`, `alias`, `extension` and `config`
  (finding the subcommand past global flags), then runs the real gh the daemon named with an env built from scratch:
  `HOME`, `USER`, the locale and terminal, the daemon's PATH, `GH_TOKEN`, `GH_HOST=github.com`, a fresh empty
  `GH_CONFIG_DIR` (removed after), prompts, pager and update checks off. No `NODE_OPTIONS`, `GIT_*`, `PAGER`, `BROWSER`,
  `EDITOR` or `GH_BROWSER` of the card's.
- **The daemon** (`lib/connector-client.ts`) asks weft.zip per card and repo, and holds each answer in memory only, until
  2 minutes before its expiry. The repo comes from the card's checkout's origin, never the caller.

### Settings → Devices

A paired worker's row gets one small badge, **Connectors** (or **GitHub ✓** when on), that opens the menu in place
(`components/WorkerConnectors.tsx`, `lib/use-worker-connectors.ts`, `/api/devices/connectors`, `lib/connector-view.ts`):
Connect GitHub (once, in the browser pane), Turn on / Turn off, and the settings as checkmarked choices:

| Setting | Choices (default first) | Enforced by |
| --- | --- | --- |
| Scope | All installed repos · This project's repo · The card's repo | the mint: a user token, or a token scoped to the repo |
| Approval | Once per worker · Per project · Per card | the mint: an Allow row for the project or card |
| Lifetime | Until revoked · 24 hours · 8 hours | the grant's `expires_at`, set by the database |
| Ask before | Push to a protected branch (on) | stored and handed to the worker with each token (`asks`); see below |

Turning on, and any change that gives cards more (wider scope, weaker approval, longer lifetime, an ask taken off), asks
Touch ID in main (`electron/connector-grants.cjs`, held to `lib/connector-grant.ts` by a parity test); a stricter change
doesn't. Turning off and revoking the worker go through weft.zip (`lib/connector-remote.ts`), which deletes the grant
first, so minting stops at once, then deletes each scoped token at GitHub and, if this worker was handed the current
user token, refreshes it (which ends it, per GitHub); the row then says what GitHub confirmed ("GitHub off · 2 tokens
revoked ✓"), or when an unconfirmed token ends by itself. Disconnect GitHub (`DELETE /api/connectors/github`) deletes
the whole authorization at GitHub and the stored refresh token.

### Its limits, plainly (layer 1)

- **A card can copy what it's handed.** Every card runs as the worker's one OS user, so a prompt-injected card can read
  the token from the socket, the helper or gh's env. With the default scope that token reaches every repo the app is
  installed on, as you, until weft.zip next rotates it (about an hour, while cards keep asking) and at most GitHub's 8
  hours; Turn off ends it at once. The on-box helper (design phases P4 and P5) is what turns "use and copy" into "use only".
- **The worker's key is on the box.** A card that takes `worker.json` and `sign-key.json` can ask for fresh tokens for any
  live card you started on that worker, for as long as the connector is on. The lifetime setting and Turn off bound it.
- **Ask before a protected-branch push is a setting, not yet a gate.** Weft can't see a push's ref without a proxy; the
  setting is stored and handed to the worker with each token (`asks`), for the helper's git forwarder (P4) to enforce.
  Deleting a repo needs no ask: the app has no Administration permission, so no token Weft hands out can do it.
- **A start with no git URL pins the repo the worker names.** A `run` names its repo (`https://github.com/<owner>/<name>.git`),
  and that's what a card is held to. A `new_card` or `card.create` names only a folder, so the first mint pins the
  `owner/name` the worker asks for when its name is the folder's; the owner part is the worker's word. Under the default
  scope it decides nothing (the token reaches every installed repo anyway); under a narrow scope it picks which same-named
  repo the token is narrowed to.
- **One chain per user**: turning GitHub off for one worker rotates the shared user token, so another worker's next git
  call fetches a fresh one (its held copy is refused once, then `erase` and a new ask).
- **The Mac as minter** (P1b) slots in behind `TokenDeps` (`lib/connector-tokens.ts`): the same `mint()` with the refresh
  token in the 🔐 vault and main answering through `device_calls`.
