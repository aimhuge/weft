# Mobile security: pairing, sealed sync, signed approvals

Status: **built on the Weft side** (2026-10-29); migration `supabase/migrations/20261029105556_mobile_security.sql` is applied. The phone app (`~/dev/weft-mobile`, Expo) is a
separate repo; this doc is its contract. What a phone does is in **Phone side**; everything else is in this repo.

A synced card can be answered from a phone: a reply, Stop, and an **Allow** on a permission request, which makes
the Mac run a tool. Before this, anyone holding the account's Supabase session (a stolen cookie, a leaked refresh
token) could insert an `answer` command and the Mac would obey it, and every thread item sat in Supabase as plain
JSON for the database, Weft's operators and every backup to read. Three pieces close that:

1. **Pairing**: a phone (or a browser) becomes a device the Mac knows by a key the Mac pinned itself, after a QR
   code only the person at the Mac can see.
2. **Sealing**: item bodies, the readable parts of a card, and long tool outputs go up encrypted with a workspace
   key; only paired devices hold it. Ids, columns, kinds and timestamps stay plain, so feeds, Realtime and push work.
3. **Signed approvals**: an Allow from a phone carries an Ed25519 signature the phone only makes after Face ID; the
   Mac checks it against the key it pinned at pairing.

The threat model in one line: **the server and the session are not trusted; the Mac and the paired device are.**
A compromised Supabase project, or someone with the account's session, can read ciphertext, delete rows and refuse
service, but can't read a sealed thread, pair a device, or approve a tool run.

## Keys

| key | kind | where it lives | made by |
|---|---|---|---|
| Mac device key | X25519 (libsodium box) | `~/.weft/device-key.json`, private half under safeStorage (Keychain) | already built (teams-vault.md) |
| Workspace sync key | 32 random bytes, XChaCha20-Poly1305 | Electron main, `~/.weft/vault/sync-keys.json` under safeStorage; Supabase holds it only sealed to devices | the first Mac that seals for the workspace |
| Phone box key | X25519 | phone SecureStore | the phone at pairing |
| Phone signing key | Ed25519 | phone SecureStore with `requireAuthentication` (Face ID / passcode to read) | the phone at pairing |
| Pairing secret | 32 random bytes | Electron main's memory and the QR code, never the server | the Mac, per pairing, 5 minutes |

Every primitive is libsodium (`libsodium-wrappers` on the Mac and the web, `react-native-libsodium` on the phone),
so the three sides compute the same bytes: `crypto_box_seal` for wrapping, `crypto_aead_xchacha20poly1305_ietf`
for sealing, `crypto_sign_detached` for Ed25519, `crypto_auth_hmacsha512256` for the pairing proof.

**Why a workspace key and not the repo vault keys.** The shared vault's keys are per (org, repo) (teams-vault.md,
"per-vault, not per-org"), but a synced card belongs to an org, and a folder with no GitHub origin syncs too. One
key per workspace, versioned, wrapped per device the same way the vault keys are. Its tables are separate from the
vault's (`workspace_keys`, `workspace_key_grants`) so the 🔐 drawer and the Devices tab don't see a fake vault.

## 1. Pairing

```
 Mac (Settings → Sync)                Supabase (phone_pairings)              Phone (signed in, same account)
 ─────────────────────                ─────────────────────────              ───────────────────────────────
 S = 32 random bytes (memory only)
 insert {user, org, mac_device,  ───▶ row status=open, 5 min
         mac_key}                     (no secret on the server)
 QR: https://weft.zip/pair#v=1&p=<id>&s=<S>&o=<org>&m=<mac fingerprint>
                                                                     ◀── scan; make box + sign keypairs
                                      ◀── update {box_key, sign_key, name, platform,
                                            proof = HMAC(S, claim), sig = Ed25519(claim)}  status=claimed
 poll sees claimed; check proof with S, check sig with sign_key
 Touch ID: "Pair Alex's iPhone (ab:cd:…)?"
 pin {device, sign_key, box_key} locally (sealed)
 insert devices row (platform ios, kind phone)
 wrap sync key to box_key → workspace_key_grants
 update status=paired, device_id  ──▶                                ──▶ sees paired; reads its grant; unwraps
```

- The pairing link is an https URL so the phone camera opens weft.zip when the app isn't installed (the app claims it
  as a universal link). **The secret is in the fragment**, which a browser never sends, so the server never sees S.
- `claim` is the canonical string `weft-pair-v1\n<pairing id>\n<org id>\n<box key b64>\n<sign key b64>\n<name>\n<platform>`.
  The proof (HMAC with S) shows the claimer saw the QR; the signature shows it holds the signing key it names. A
  server that swaps the keys in the row fails the proof; one that never relays the claim only stalls the pairing.
- **The Mac's pinned list is the authority**, not `public.devices`: the server could add a row, the Mac would never
  pin it. The list is `~/.weft/vault/paired-devices.json`, sealed with safeStorage (so a thread can't add a key to
  it: the vault folder is refused to threads by `lib/secret-guard-files.ts`, and an edit would not decrypt).
- Pairing is started and confirmed over IPC from the board window (`pairing:*` in `electron/pairing-ipc.cjs`), never
  over the control server: a thread can call control routes, and a thread that could pair would approve itself.
  Confirming also takes Touch ID, so a board-side script can't pair silently either.
- **Pair a browser** is the same flow with the link opened on the computer instead of scanned (Copy link): the
  web's `/pair` page claims with a key it keeps in IndexedDB. A browser key is weaker than a phone's (any script on
  weft.zip can use it), so a browser can read sealed threads but **can't sign approvals** (`kind = 'browser'`).
- **Revoke** (Settings → Sync → the device's Revoke): unpin first (that alone stops its approvals), delete its
  `workspace_key_grants`, set `devices.revoked_at`, then **rotate** the workspace key: a new version, wrapped to the
  Mac and every device still pinned. Rows already sealed stay under the old version (the revoked device may have read
  them); everything after is under the new one. A trigger keeps `revoked_at` from being cleared again.
- Each Mac pairs on its own: a phone paired with the MacBook isn't trusted by the Mac mini until it's paired there
  too. A second Mac on the same workspace finds a key it has no grant for and uploads plain rows (`POST /sync/key` says
  `none`); Mac-to-Mac pairing is under Gaps.

## 2. Sealing

`lib/sync-seal.ts`, isomorphic (the Mac's server, the web board in the browser, and the phone app's copy).

An envelope replaces the value it seals:

```json
{ "$sealed": 1, "v": 2, "n": "<24-byte nonce b64>", "c": "<ciphertext b64>" }
```

`v` is the workspace key version. The associated data binds a ciphertext to where it sits, so the server can't
move a sealed item onto another card or seq and have it open: `weft-sync-v1\n<org>\n<card>\n<slot>`, where slot is
`item:<seq>`, `card` or `tool:<tool id>`.

| table | sealed | plain |
|---|---|---|
| `cloud_thread_items` | `item` (the whole ThreadItem) | `org_id`, `card_id`, `seq`, `kind`, `at` |
| `cloud_cards` | `card.title`, `prompt`, `lastLine`, `error`, `suggestion`, `remaining`, `touchedFiles`, `claims` → `card.sealed` | ids, `column`, `status`, `emoji`, `stage`, `tags`, timestamps, `folder`, `page` refs |
| `cloud_tool_outputs` | `result` (the envelope as JSON text) | `tool_id`, `bytes` |
| `weft-blobs` pages | the file's bytes (`nonce ‖ ciphertext`), designed here, wired in a follow-up card | the `blob:sha256:` ref (hash of the plaintext) |

- A sealed card's `title` reads `"🔒"` in the row, so a feed or a push that can't open it still draws something.
- **Gradual.** Readers take both: `openItem` / `openCard` / `openToolResult` return a plain value unchanged and a
  sealed one opened, or a stand-in (`🔒 Sealed — pair this device to read it`) when the reader has no key for its
  version. Writers seal only when **Seal synced threads** is on (Settings → Sync → Pair a phone, off by default until
  the phone app ships) and the Mac holds the key; otherwise they upload plain as before. Both switches live in main's
  sealed `paired-devices.json`, not a server setting: a thread can call the server's routes with the plain token, and one
  that could flip "approve from the web" would lower the bar for itself. Turning that one on takes Touch ID.
- **Shared cards stay plain.** A card with a live share link (`card.share`) is read server-side by `/s/…`, which has
  no key; sharing is publishing, and the Share dialog already says so.
- Redaction (`lib/cloud-sync-redact.ts`) still runs first: sealing protects from the server, redaction from teammates.
- The web board opens rows in the browser (`lib/web-sync-key.ts` holds the browser's unwrapped keys in memory, read from
  its grants on load). The server render and the first client render both draw the 🔒 stand-ins; once the keys are in,
  `useWebBoard` reopens the cards and reloads the open thread, so hydration never disagrees.

## 3. Signed approvals

The answer command (`kind: "answer"`, `lib/cloud-commands.ts`, built by the card "📱 Answer questions & permissions
from the phone/web mid-turn") gains an optional `auth` beside its payload fields:

```ts
interface ApprovalAuth {
  device: string;     // public.devices.id of the phone
  issuedAt: number;   // ms since epoch, the phone's clock
  sig: string;        // Ed25519 over approvalMessage(...), base64
}
```

The signed message (`lib/approval-sig.ts` `approvalMessage`) is the canonical string

```
weft-approval-v1
<org id>
<target Mac device id>
<card id>
<pending id>
<allow|deny>
<issuedAt>
<BLAKE2b-256 (crypto_generichash) of the canonical answers JSON, hex, or "-">
```

An answer that grants a folder (`grant` on the payload, [the folder gate](thread-guards.md)) adds a ninth line,
`grant:card` or `grant:always`; a plain answer's message is unchanged. So a signature can't be replayed onto another
Mac, card, request, decision, set of answers or folder grant. The phone builds it,
asks Face ID to read the signing key (`expo-local-authentication` + SecureStore `requireAuthentication`), signs, and
inserts the command.

The Mac (`lib/cloud-inbox.ts` → `lib/approval-check.ts`) decides before `answerPermission`:

- `auth` present: main verifies (`POST /pairing/verify` on the control server, which reads the pinned key; the
  server process never holds it). Refused when the device isn't pinned (or is a browser), the signature fails, or
  `issuedAt` is more than 5 minutes from the Mac's clock. A pending id answers once, so replay inside the window
  finds nothing waiting.
- No `auth`: a **Deny** or a question's answers go through as before. An **Allow on a permission request** goes
  through only while no phone is paired, or when **Approve from the web without a phone** is on in Settings → Sync.
  Once a phone is paired, an unsigned Allow fails with "Approve this on your paired phone".

## Tables (`supabase/migrations/*_mobile_security.sql`)

- `devices`: `kind text` (`desktop` default, `phone`, `browser`), `sign_key text` (Ed25519 public, phones only),
  platform also `ios`, `android`, `web`; a trigger refuses clearing `revoked_at`; `update (revoked_at)` granted on own rows.
- `phone_pairings`: `id`, `user_id`, `org_id`, `mac_device` (the Mac's `lib/device-id.ts` id), `mac_key`, `status`
  (`open` → `claimed` → `paired` | `cancelled`), `expires_at` (5 min), the claim (`name`, `platform`, `kind`,
  `box_key`, `sign_key`, `proof`, `sig`), `device_id`. RLS: the user's own rows; a claim only while `open` and unexpired.
- `workspace_keys` (`org_id`, `version`, `created_by`): one row per key version; members read, members insert.
- `workspace_key_grants` (`org_id`, `version`, `device_id`, `wrapped_key`, `granted_by`): a device's owner reads its
  own; a member inserts for the org; the granter or owner deletes.
- `cloud_commands` gains nothing: `auth` rides in `payload`.

## Where it lives

- `lib/sync-seal.ts` — envelopes, AAD, seal/open for items, cards and tool outputs (isomorphic).
- `lib/approval-sig.ts` — the signed message, sign (for tests and the phone's copy) and verify.
- `lib/pairing-link.ts` — the QR link, its parsing, the claim string and its proof.
- `lib/approval-check.ts` — the inbox's rule above.
- `lib/sync-seal-upload.ts` — the uploader's hook: seals rows when the switch is on and main hands over the key.
- `lib/sync-security.ts` — reads main's `POST /pairing/status` (approvers and the two switches); unreachable reads as "paired".
- `lib/web-sync-key.ts` — the browser's keys (localStorage), its keyring, opening rows, and pairing a browser.
- `lib/use-pairing.ts` — the Settings card's state over `window.weft.pairing`.
- `electron/sync-keys.cjs` — the workspace key: load, create v1, open a grant, wrap for a device, rotate.
- `electron/paired-devices.cjs` — the pinned list (sealed file), verify an approval.
- `electron/pairing.cjs` — start (finding your own workspace), poll, confirm (Touch ID), cancel, revoke;
  `electron/pairing-ipc.cjs` wires IPC (`pairing:start|check|cancel|list|revoke|settings|set-settings`) and the control
  routes (`POST /sync/key`, `POST /pairing/verify`, `POST /pairing/status`, spread in `electron/pane-routes.cjs`).
- `electron/pairing-crypto.cjs` — main's copy of the claim and signature checks; `electron/pairing.test.ts` proves it
  agrees with the TypeScript byte for byte.
- `components/PairDevices.tsx` — Settings → Sync's **Pair a phone**: the QR code (`qrcode-generator`), Copy link for a
  browser, the paired list with Revoke, the two switches. It sits under **Phones** (`components/PhoneSettings.tsx`,
  mobile.md): signing in on the app gets a phone its pushes; pairing gets it the key and lets it approve.
- `app/pair/page.tsx` + `components/web-board/PairBrowser.tsx` — Pair a browser on weft.zip (in the proxy's matcher, so
  the session is fresh); the link's # survives a sign-in in sessionStorage.
- `lib/libsodium-wrappers.d.ts` — typings; `vitest.config.ts` and `next.config.ts` alias the package to its CommonJS
  build, since 0.7.16's ESM build imports a `libsodium.mjs` it doesn't ship.

## Phone side (weft-mobile)

1. Sign in (Supabase, same account). Scan the QR or open the universal link; parse with the same rules as
   `parsePairingLink`. Refuse if expired or the org isn't one of yours.
2. Make an X25519 box keypair and an Ed25519 signing keypair; keep both private halves in SecureStore, the signing
   one with `requireAuthentication: true`.
3. Update the `phone_pairings` row with the claim, proof and signature; wait (Realtime or a 1 s poll) for `paired`.
4. Read `workspace_key_grants` for its `device_id`, `crypto_box_seal_open` each version, keep them in SecureStore.
   Re-read on every launch: a rotate adds a version.
5. Open sealed rows with the same AAD; show the stand-in for a version it has no grant for.
6. On Allow: Face ID → read the signing key → sign `approvalMessage` → insert the `answer` command with `auth`.

## Gaps

- Page blobs are designed (bytes `nonce ‖ ciphertext`, AAD `weft-blob-v1\n<org>\n<sha>`) but not wired: the blob store
  and the page route are being reworked by the R2 and pane-images cards. The web would fetch the bytes and frame them
  through a `blob:` URL instead of the page route.
- A Weft Worker seals nothing: it holds no workspace key, so its rows and pages stay plain even with sealing on
  ([Pages from a worker](weft-worker.md#pages-from-a-worker)).
- Each Mac pins its own phones; a second Mac needs its own pairing, and has no way yet to get the workspace key (it
  uploads plain rows meanwhile).
- A browser key sits in IndexedDB, readable by any script on weft.zip; that's why browsers read but never approve.
- Old rows stay plain until their card changes; there's no backfill that reseals a workspace.
- The workspace key isn't in the shared vault's recovery words: lose every paired device and the Mac, and sealed
  history is gone (new rows still sync under a fresh key).
- A teammate's devices aren't granted the workspace key yet (a workspace is personal for sync today, cloud-sync.md).
