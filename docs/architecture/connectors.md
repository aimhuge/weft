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
"Lending connector sign-ins to a Weft Worker" (rev. 4) and the T2 red team ([project-hosts.md](project-hosts.md#connectors-on-a-worker-github-p1-as-built)),
then reworked the same day after its own red team (PR #62): every yes is now signed by a Mac's approval key and
checked again by the mint, see [the chain of trust](#who-may-say-yes-the-chain-of-trust).
A card on a paired Weft Worker can push, open pull requests and use `gh` **as you, with Weft**, through GitHub App user
access tokens that weft.zip mints and refreshes. Nothing long-lived reaches the box: your refresh token and the app's
secrets stay on weft.zip, and what a card gets is a short user token, narrowed to the card's repo by default. Unit-tested
on every side, and the migration was applied to a scratch Postgres; not yet run against GitHub or a live worker (the
app isn't registered yet).

```
connect (once):   Settings → Devices → a worker → Connectors → Connect GitHub ─ browser pane ─ weft.zip/api/connectors/github/start
                  (GET: one button; its POST, same-origin only, ends any earlier connection at GitHub, then a state + PKCE
                  verifier in a MACed __Host- cookie) ─ GitHub consent ─ /callback ─ code + verifier ─ ghu_ (8 h) + ghr_ (6 months)
                  sealed with WEFT_CONNECTOR_TOKEN_KEY ─ connector_github_tokens (service role only)
this Mac's key:   main registers its desktop approval key (electron/desktop-signer.cjs) ─ POST /api/connectors/signers, signed by
                  that key, after a change's Touch ID ─ connector_signers: trusted once you open the emailed one-time link, or when a
                  trusted Mac vouches for it
pairing a worker: worker_pair_confirm under Touch ID ─ main pins the box's keys (electron/worker-pins.cjs) and signs them
                  ─ POST /api/connectors/pin ─ connector_worker_pins
turn on / change: Touch ID in main ─ main signs {you, worker, connector, settings, nonce, time, epoch it replaces}
                  ─ POST /api/connectors/github/grant: signature, freshness, nonce once, the vouched pairing, the epoch
                  ─ connector_grants (no session can write it); a stricter change also ends the worker's tokens
a card's git/gh:  git credential helper / scripts/worker-bin/gh ─ scripts/weft-connector-helper.cjs ─ ~/.weft-worker/connector.sock
                  (lib/connector-socket.ts: the capability → its card, only for a process under that session's CLI; the repo
                  from the card's own origin) ─ lib/connector-client.ts: signed with sign-key.json,
                  Bearer wwk_ ─ weft.zip/api/connectors/github/mint (lib/connector-mint.ts) ─ token + expiresAt, in the daemon's memory
turn off/revoke:  DELETE /api/devices/connectors?worker= ─ weft.zip/api/connectors/github/revoke ─ grant deleted, tokens ended at
                  GitHub under the refresh claim, what GitHub confirmed shown on the row; the daily sweep retries the rest
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
key** (a `.pem`). Put them in the 🔐 vault for the weft project, **production only**: `GITHUB_APP_ID`,
`GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, plus `WEFT_CONNECTOR_TOKEN_KEY` (64 hex chars,
`openssl rand -hex 32`), and push each to the Vercel project's Production environment (`mcp__secrets__push_to_vercel`).
Never give the token key to Preview or Development: a preview build would then open production's sealed refresh
tokens; without it a preview answers 503. To rotate it, set a new key with a new `WEFT_CONNECTOR_TOKEN_KEY_ID` and list
the old ones in `WEFT_CONNECTOR_TOKEN_KEYS_OLD` (`<id>:<hex>,…`): old seals still open, every refresh seals with the new
key (`lib/connector-crypto.ts`). `RESEND_API_KEY` (already there for team invites) sends the notices below, and
`CRON_SECRET` (already there) guards the daily sweep (`vercel.json`; hourly needs a paid Vercel plan, where it's a
one-line change). P1 uses the client id and secret and the token key; the app id
and private key are for the `weft[bot]` installation tokens a later phase may add. Finally **Install App** on the repos
you want workers to reach ("Only select repositories"): a user token reaches only repos the app is installed on that you
can also reach.

### Who may say yes: the chain of trust

The first version wrote grants with your Supabase session after a Touch ID in main, and the database couldn't tell that
write from any other with the same session: a stolen weft.zip session, or a thread that read `~/.weft/account.json`, could
pair a box of its own (the `worker_pair_*` functions are plain RPCs), insert a start command and a grant, and mint. Now
**the session is never enough**: every yes is an Ed25519 signature by a Mac's approval key, which only Electron main holds
(`electron/desktop-signer.cjs`, sealed in `~/.weft/vault`, which threads can't read), made after Touch ID.

- **What's signed** (`lib/connector-messages.ts`, main's byte-for-byte copy `electron/connector-sign.cjs`):
  `weft-connector-grant-v1` over you, the worker, the connector, the settings, a nonce, the time and the epoch it
  replaces; `weft-connector-allow-v1` for an Allow; `weft-connector-worker-v1` over the worker's sign and box keys this
  Mac pinned when it paired it. The routes (`lib/connector-signed.ts`) take a statement within 2 minutes of its time, its
  nonce once (`connector_signed_nonces`), and a grant only at the epoch it names, so a signed change can't re-create a
  grant turned off since. They write with the service role; `authenticated` has no insert, update or delete on
  `connector_grants`, `connector_allows`, `connector_signers` or `connector_worker_pins`. **The mint checks it all again**
  (`lib/connector-trust.ts`): the grant's and the Allow's signatures against a signer trusted *now*, and the worker's pin
  for the sign key its row has now.
- **How a Mac key gets there.** The desktop approval key was never in `public.devices`: that table holds each Mac's
  X25519 vault key, which any signed-in session can add (RLS "devices: add own"). The Ed25519 approval key reached workers
  only inside pairing codes, by hand. So weft.zip gets its own list, `connector_signers`, written only by
  `POST /api/connectors/signers` (`lib/connector-signers.ts`), which needs the key's own signature over you, the key, its
  name and the time (proof the caller holds it). Main registers its key only as part of a change it signs, after that
  change's Touch ID (turning a connector on, an Allow, vouching, pairing a worker), never because Settings opened.
- **Chosen: an emailed one-time link, or a vouch from a trusted Mac.** A session can register a key of its own, so a new
  key is **untrusted until someone opens the link mailed to the account's own address**: a one-time confirm link (good for
  24 hours, sent again on a later registration after 10 minutes, at most 4 emails in all) and a revoke link, which
  weft.zip keeps only as sha256; every revoke link ever mailed for the key keeps working (`lib/connector-signer-links.ts`).
  The id and token ride in the link's **fragment**, which browsers never send, so they stay out of server and Vercel
  logs; the page's one hash-allowed script copies them into its form. There's no path by time alone, and with no mailer (`RESEND_API_KEY` unset) a key
  can't be registered at all: weft.zip refuses with a clear message rather than leave a key nobody can confirm. The email
  is in fixed words: the key's fingerprint, the time, the IP address and client the registration came from, never the
  name the registering client chose. Each link opens a page with one button (`/api/connectors/signers/confirm`,
  `/revoke`), so a mail scanner that fetches links presses nothing; **Revoke this key** works without a session, which is
  the point when the session is what was stolen. A Mac that's trusted can still make another trusted at once: Settings →
  Devices lists keys still waiting, and **Trust** asks Touch ID on the trusted Mac naming the other Mac's key fingerprint,
  then signs `weft-connector-endorse-v1` (`POST /api/connectors/signers/endorse`). A session can always take trust
  **away** (Remove: `DELETE /api/connectors/signers?id=`), which ends the grants that key signed, the worker pins it
  signed and the tokens under them; at worst that's a denial of service.
- **Setup checks for this to hold.** Supabase Auth's **Secure email change** must be on (a session alone can't move the
  account to an address it controls), and changing the password must sign out the account's other sessions, since that's
  what the emails tell you to do.
- **What remains: whoever controls the inbox controls trust.** A stolen session plus the account's email (or a mailbox
  rule forwarding it) confirms a key of the attacker's own. The vouch path doesn't have that weakness, but the first Mac
  has nobody to vouch for it.
- **Starts are signed too, once, fresh, and only from the board.** A grant is per worker, so the mint also needs to know
  a card was really started from your board: `cloud_commands` is insertable by any session. When **Weft's own window**
  starts a thread on a worker (`POST /api/cards` passing `elevated`, never a thread's curl with the plain token), the
  server asks main over the token-guarded control server (`POST /connectors/sign-start`, `electron/connector-start.cjs`) to
  sign `weft-connector-start-v1` over you, the worker, the card id, the folder, the repo and a fresh nonce; main signs
  only a repo it knows that folder as (`electron/worker-projects.cjs`). No Touch ID per card: the grant is the yes. The
  mint (`lib/connector-card.ts`) takes only the one `card.create` for that card id, signed by a key trusted now, whose
  row was made within 5 minutes of signing (a replayed row is late), and pins the card to that signature
  (`connector_cards.start_sig`, unique: one signature pins one card). Every later mint re-checks the start's signer is
  still trusted; a card seen Done or deleted has its pin **closed** for good, and the worker never makes a card under an
  id it has had before (`lib/host-api/card-ids.ts`, a list kept in its data folder).
- **The grant names its repos.** When you turn GitHub on (or change it), main reads the GitHub repos this Mac has
  checkouts of (`createKnownRepos`), names them in the Touch ID prompt, and signs them into the grant. The mint refuses a
  card in any repo the grant doesn't list, so rewriting a checkout's origin later (a thread could) can't widen it; covering
  a new repo means turning GitHub on again from the Mac with that checkout (more repos counts as looser).
- **Workers are vouched for the same way.** Pairing (`electron/host-pairing.cjs`) pins the box key and sign key it just
  checked under Touch ID, then signs them for weft.zip (`vouchWorker`); turning a connector on vouches again from that
  local pin, never from the row. A worker this Mac didn't pair (or paired before this change, with no sign key pinned)
  can't be vouched for from this Mac: turn GitHub on from the Mac that paired it, or pair it again here.
- **Notices.** A new Mac key, a key trusted by a vouch, a worker vouched for, GitHub turned on for a worker and a
  reconnect to another GitHub account each go to your email (Resend, `lib/connector-notify.ts`) and into your ledger
  (`connector_mints`, outcome `notice`). A notice that can't be sent never blocks what it's about.

### What weft.zip holds and checks

- **`connector_github_tokens`**: one row per user, the refresh token and the current access token, each sealed with
  AES-256-GCM bound to the user and the field (`lib/connector-crypto.ts`). RLS on, no policy, no grant: only the service
  role reads it. `disconnect_pending_at` marks a disconnect GitHub didn't confirm: nothing mints from it, and the sweep
  retries.
- **`connector_signers`** and **`connector_worker_pins`**: above. Your session reads its own; only weft.zip writes.
- **`connector_grants`**: one per (you, worker, connector) with `scope`, `approval`, `lifetime`, `asks`, and the signature,
  signer, nonce, time and `epoch` it was written with. The database sets `created_at` and `expires_at` from the lifetime
  (restarting it when the lifetime changes). A worker revoked by `device_revoke` loses its grants in a trigger.
- **`connector_allows`**: the project or card Allows that per-project and per-card approval need, signed the same way.
- **`connector_mints`**: the ledger, every answer to a worker, readable by you ("last used" and the waiting Allows in
  Settings come from it), and the notices. A `user` answer records which token it handed (`token_issued_at`).
  `connector_mint_admit` logs a request under its nonce and both rate limits in one step, under a lock per user.
- **`connector_live_tokens`** and **`connector_cards`** (service role only): narrowed tokens handed out or retired, so a
  revoke or the sweep can delete them at GitHub; and the cards a mint has checked you started.

The mint (`lib/connector-mint.ts`) decides from those rows, never the worker's word: the `wwk_` key (sha256 against
`cloud_workers.key_hash`), a signature by the worker's Ed25519 sign key over every field (`cloud_workers.sign_key`, set only
by `worker_pair_confirm`; a token-enrolled worker has none and gets nothing), a timestamp within 2 minutes; **a trusted
Mac's pin of that sign key**; then, in one database step, a nonce logged once and at most 30 asks a minute and 300 an hour
per worker, 60 and 600 per user across all of them; then a live grant **signed by a Mac trusted now**; then a card **you
started from the desktop board**: the one `card.create` for that card id (its id is in the args you wrote), never one
another worker sent (`fromWorker`), carrying the repo (the project's `owner/name`, read from this Mac's own checkout of
that folder: `lib/worker-folder-repo.ts`) and **main's signature over the start** by a key trusted now, pinned on first
use (a run's or new_card's card id is the worker's own report, which `worker_report` can no longer change once set, so
those carry no signed start and get nothing); this worker's card not Done or deleted (`cloud_cards` filtered on `owner_worker`); and, under per-project or
per-card approval, a signed Allow (else 403 with `needs: "allow"` and the ledger says `needs_allow`, which puts an
**Allow** button in the worker's Connectors menu, behind Touch ID). A start with no repo or no signature (one made on
weft.zip, which can't read the project's origin, or queued by a session alone) gets no token.
Once it has the token, the mint writes it to the ledger, **reads the grant again** and answers only if it's still there
at the epoch it checked; so a revoke that deletes the grant after that read finds the token in the ledger.

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
holder stops using it 2 minutes before that, and weft.zip refreshes only after that point. Every refresh, a mint's, a
revoke's or a disconnect's, first claims `refreshing_until` and the others wait for its answer, so two never spend the
same refresh token, and whoever holds the claim reads the pair again before spending it (one that finished between its
read and its claim already did the work). **Scope** "This project's repo" (**the default**) and "The card's repo" hand out a **scoped user
token** for that one repo, with contents and pull-request write and metadata read, still as you; it's kept per project or
card, reused while young and while its parent is still the current token, made by one mint at a time per (worker,
subject) under a claim (`connector_live_claims`), so two at once can't each overwrite the other's row and leave a working
token nothing tracks; when it's replaced the old one is deleted
at GitHub first, or kept as a `retired:` row for the sweep when GitHub doesn't confirm. "All installed repos" hands out
the user token itself. A **204 is the only confirmation**: a 404 from a delete reads as unconfirmed, since GitHub answers
it for a token it doesn't know as well as for one that's gone.

**Revoking** (`lib/connector-revoke.ts`): Turn off, revoking the worker, a stricter grant, a removed Mac key and the
sweep's expired grants all end the worker's tokens the same way. Each narrowed token is deleted at GitHub and its row
dropped only on the 204. The user token is rotated while the ledger says this worker holds the current one (by its
`token_issued_at`, so the worker whose own mint did the refresh is caught too): it claims the refresh, waiting out one in
flight and checking again after it, and spends it; if the refresh fails it deletes the old token instead.
**Disconnect** deletes every grant, marks the chain pending, and deletes the whole authorization at GitHub with a token
GitHub still knows (refreshing first when the stored one is past 7 hours); the chain and the narrowed rows are forgotten
only once GitHub answered 204. **The sweep** (`lib/connector-sweep.ts`, `GET /api/cron/connectors`, daily in
`vercel.json`) revokes grants past their lifetime, deletes narrowed tokens no grant covers (dropping the row on a 204 or
once it's past its life: its `expires_at`, else 8 hours), retries pending disconnects and drops day-old nonces.

Not in GitHub's docs, and so assumed until a live run: how long a scoped token lives (the answer's `expires_at` is
stored when given; 8 hours is assumed otherwise), and whether refreshing its parent ends it (Weft never hands one out
again once its parent has rotated, so either way is safe).

**Reconnecting.** Connect's POST deletes the old authorization at GitHub before it sends you to GitHub, and forgets it
once confirmed. If the account that comes back is a different GitHub account, every worker's grant is turned off (you
approved the other one) and you're told; if the old authorization wasn't confirmed gone, a different account is refused
(and its fresh authorization deleted) until you remove Weft at github.com/settings/apps/authorizations.

### On the worker

`lib/connector-worker.ts` starts with the daemon (`scripts/weft-worker.ts`), only on a paired box. It reads the box's own
`credential.https://github.com.helper` entries and the real `gh`, hashes the helper and the gh wrapper, opens
`~/.weft-worker/connector.sock` (mode 600) and sets what every CLI process's env gets (`lib/connector-env.ts`, from
`lib/runner-session.ts` and `lib/codex-runner.ts`): the socket's path, a random capability per CLI process,
`scripts/worker-bin` first on PATH, and `GIT_CONFIG_*` entries that reset git's helpers for `https://github.com` and put
Weft's first, then the box's own (so a pasted `github_login` token still works where GitHub isn't turned on). No token is
in that env.

- **A capability answers only its own session.** `lib/cli-process.ts` binds it to the CLI's pid as it spawns and drops it
  when that process exits (Codex starts a CLI per turn, so its capabilities are per turn). The socket reads the asking
  process's pid from the OS (`lib/connector-peer.ts`: lsof's socket addresses on macOS, the LOCAL_PEERPID answer; ss's
  inodes on Linux, the SO_PEERCRED answer; Node has no getsockopt) and answers only a process descended from that CLI. A
  capability read from another process's environment (`ps eww`, `/proc/<pid>/environ`) is worth nothing outside its
  session's process tree; a peer that can't be read gets nothing.
- **The helper's hash is checked, as tamper-evidence only.** Every card's git runs `scripts/weft-connector-helper.cjs`
  and every card's gh the wrapper, from Weft's clone, which the worker's thread guards keep read-only to threads
  (`lib/worker-clone-guard.ts`). The daemon also hashes both files at start and refuses every ask once either changed,
  until a restart. That catches a careless edit; it is **not a control**: a card running as the worker's user can swap the
  helper in, let it run, and put the original back between two checks. The same user is one trust domain.
- **git** runs the helper's `git-credential get` (through `env -u NODE_OPTIONS -u NODE_PATH`), which asks the socket and
  prints `username=x-access-token`, the token and `password_expiry_utc` on stdout to git. `erase` drops the daemon's copy.
- **gh with no token** works as it did before the connector, `gh auth` included: when the socket has nothing for the
  card (GitHub isn't turned on for the worker, weft.zip isn't set up yet, the daemon is down), the wrapper runs the real
  gh found on the card's PATH past its own folder, with the card's own env and the box's own sign-in, if any. Only while
  the connector's token is in use are `auth`, `alias`, `extension` and `config` refused.
- **gh** is `scripts/worker-bin/gh`, the same helper's `gh` mode: with a token it refuses `auth`, `alias`, `extension` and
  `config` (finding the subcommand past global flags), then runs the real gh the daemon named with an env built from scratch:
  `HOME`, `USER`, the locale and terminal, the daemon's PATH, `GH_TOKEN`, `GH_HOST=github.com`, and one fresh empty folder
  (removed after) as `GH_CONFIG_DIR`, `GH_DATA_DIR` and `XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`XDG_STATE_HOME`/`XDG_CACHE_HOME`, so
  no alias or extension of the card's runs; prompts, pager and update checks off. No `NODE_OPTIONS`, `GIT_*`, `PAGER`,
  `BROWSER`, `EDITOR` or `GH_BROWSER` of the card's.
- **The daemon** (`lib/connector-client.ts`) asks weft.zip per card and repo, and holds each answer in memory only, until
  2 minutes before its expiry. The repo comes from the card's checkout's origin, never the caller.

### Settings → Devices

A paired worker's row gets one small badge, **Connectors** (or **GitHub ✓** when on), that opens the menu in place
(`components/WorkerConnectors.tsx`, `lib/use-worker-connectors.ts`, `/api/devices/connectors`, `lib/connector-view.ts`):
Connect GitHub (once, in the browser pane), Turn on / Turn off, the settings as checkmarked choices, and, while any Mac
key is still waiting, a line saying this Mac's waits for its emailed link, and **Trust** / **Remove** for another Mac's:

| Setting | Choices (default first) | Enforced by |
| --- | --- | --- |
| Scope | This project's repo · All installed repos · The card's repo | the mint: a token scoped to the repo, or the user token |
| Approval | Once per worker · Per project · Per card | the mint: a signed Allow for the project or card |
| Lifetime | Until revoked · 24 hours · 8 hours | the grant's `expires_at`, set by the database; the sweep ends its tokens after |
| Ask before | Push to a protected branch (on) | stored and handed to the worker with each token (`asks`); see below |

Every change, turning on, looser or stricter, asks Touch ID in main (`electron/connector-grants.cjs`, held to
`lib/connector-grant.ts` by a parity test), in words that say which: "let the worker m1mini use …", "give cards on the
worker m1mini more GitHub access (…)", "make GitHub on the worker m1mini stricter (…)". A stricter change also ends the
worker's tokens at once. Turning off and revoking the worker go through weft.zip (`lib/connector-remote.ts`), which
deletes the grant first, so minting stops at once, then ends the tokens; the row then says what GitHub confirmed
("GitHub off · 2 tokens revoked ✓"), or when an unconfirmed token ends by itself. Disconnect GitHub
(`DELETE /api/connectors/github`) deletes the whole authorization at GitHub and, once confirmed, the stored refresh token.

### What the rest of Weft already trusted (checked 2026-11-02)

The red team asked to verify that main's other features (H8, T2, C) trust only keys the Mac pinned locally. Checked in
the code, it's true for some and not others:
- **H8, secrets on a worker** (`electron/worker-secret.cjs`): main seals only to the box key it pinned
  (`electron/worker-pins.cjs`) and needs the ask signed by the pinned sign key; the worker opens only a `secret_use`
  signed by the Mac key that came in its pairing code (`lib/worker-mac-keys.ts`). One exception: a worker this Mac didn't
  pair (or re-pinned) is trusted on first use from its row, after Touch ID with its key's fingerprint and "first seen now",
  then pinned; a sign key, once pinned, is sticky.
- **Re-pairing** (`electron/worker-repair.cjs`, `lib/worker-mac-keys.ts`): the box moves to another Mac only on an approval
  signed by the Mac key it trusts now, from `mac-keys.json`.
- **T2** (lending the Mac's gh and gog sign-ins) was taken out after its red team; nothing of it ships.
- **No section is named "C"**, so the claim was checked against the two readings that fit. **Card verbs and start
  commands** (`cloud_commands`, H2/H3) trust the account's session, not a pinned key: any session can insert one. That's
  why the mint no longer leans on a start command alone and needs a signed grant on top. **The H6 session line** doesn't
  check a pinned Mac key either: the sealed offer proves only that the worker answers, and anyone with the session can
  seal one to the worker's public key; so the line carries only what a session could do anyway, and a terminal over it is
  refused until offers are signed by a key the worker pins (project-hosts.md "The session line").
So "main's other features trust only keys the Mac pinned locally" holds for H8's secrets (with its first-use exception)
and for re-pairing, not for card commands or the line. The connector side trusted weft.zip's rows outright. Now it trusts only keys in `connector_signers` that a
trusted Mac vouched for or that waited out their day in your inbox, which is a weaker anchor than a key pinned on the
box (a session can register a key; only the inbox or a trusted Mac can make it count).

### Its limits, plainly (layer 1)

- **A card can copy what it's handed.** Every card runs as the worker's one OS user, so a prompt-injected card can read
  the token from the socket, the helper or gh's env. Under the default scope that's one repo, as you, until weft.zip next
  rotates it (about an hour while cards keep asking) and at most GitHub's 8 hours; Turn off ends it at once. The on-box
  helper (design phases P4 and P5) is what turns "use and copy" into "use only".
- **With the worker's own keys, per-card scope is advisory.** A card that takes `worker.json` and `sign-key.json` signs
  mints as the worker, for any live card you started there; a run's or new_card's card id is the worker's own report; and
  the "not Done" check reads the worker's own card rows. The grant's scope, lifetime and Turn off still bound it; the
  vouch, the grant and the Allows can't be forged with those keys.
- **Same-user processes are one trust domain.** The peer check stops a capability lifted from `ps` working outside its
  session; the helper's hash check only notices a careless edit. A card that can run code as the worker's user can
  ptrace or replace `node`, or swap the helper in and back out between two checks. P4/P5 again.
- **Whoever controls your inbox controls trust.** A new Mac's key counts once the emailed link is opened (or a trusted Mac
  vouches for it). A stolen session that can also read your email can confirm a key of its own; the same email's
  Revoke link, Remove in Settings and changing your password are the way back.
- **No mailer, no new keys.** A weft.zip without `RESEND_API_KEY` refuses to register a Mac key.
- **A session can still deny service**: remove your keys, turn connectors off, disconnect. It can't turn anything on.
- **Ask before a protected-branch push is a setting, not yet a gate.** Weft can't see a push's ref without a proxy; the
  setting is stored and handed to the worker with each token (`asks`), for the helper's git forwarder (P4) to enforce.
  Deleting a repo needs no ask: the app has no Administration permission, so no token Weft hands out can do it.
- **Only the desktop board's new threads get GitHub tokens**, in repos the grant names: a card started on weft.zip (which
  can't read the project's origin), by a thread through the board's route, a `run` from Settings → Workers or a card
  another worker sent carries no start a Mac signed. A local thread can't get a start signed, but anything that can
  click in Weft's own window can.
- **One chain per user**: turning GitHub off for one worker rotates the shared user token when that worker held it, so
  another worker's next git call fetches a fresh one (its held copy is refused once, then `erase` and a new ask).
- **Not verified live**: PostgREST's handling of the `->>` filter inside `or=` for the start lookup, lsof/ss output on every
  box (a box without them gets no tokens), and GitHub's scoped-token lifetime.
- **The Mac as minter** (P1b) slots in behind `TokenDeps` (`lib/connector-tokens.ts`): the same `mint()` with the refresh
  token in the 🔐 vault and main answering through `device_calls`.
