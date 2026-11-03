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
   Mac checks it against the key it pinned at pairing. A browser that paired a **passkey** on sign.weft.zip signs an
   Allow there after Touch ID (WebAuthn, ES256), checked the same way (section 4).

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
  web's `/pair` page claims with keys it keeps in localStorage. Those keys are weaker than a phone's (any script on
  weft.zip can use them), so they read sealed threads but sign nothing (`kind = 'browser'`). Approving takes a
  **passkey**, paired separately on sign.weft.zip (section 4).
- **Revoke** (Settings → Sync → the device's Revoke): unpin first (that alone stops its approvals), delete its
  `workspace_key_grants`, set `devices.revoked_at`, then **rotate** the workspace key: a new version, wrapped to the
  Mac and every device still pinned. Rows already sealed stay under the old version (the revoked device may have read
  them); everything after is under the new one. A trigger keeps `revoked_at` from being cleared again.
- **Revoked somewhere else** (another Mac, or Settings → Devices' `device_revoke`): the Mac that pinned the device reads
  `revoked_at` for its pins at most once a minute (`electron/pairing.cjs` `reconcile`, run before each passkey sync) and
  does the same unpin, grant drop and rotation; the same sync narrows every worker's passkey set
  ([device-registry.md](device-registry.md#revoked-on-one-device-untrusted-on-all)). A row it can't see unpins nothing.
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
| `weft-blobs` objects | the bytes of every attachment, page, page asset and pane capture a sealed row names ([Sealed blobs](#sealed-blobs)) | the `blob:sha256:` ref (hash of the plaintext), the content type, the size |

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

### A session line's offer, sealed in the browser or on the phone

A worker's session line opens with an offer sealed to the worker's published X25519 key
([project-hosts.md](project-hosts.md#the-session-line-h6-as-built)). The desktop's server sealed it alone until now;
`@weft/client` seals the same bytes anywhere (`packages/weft-client/src/seal.ts` `sealTo`, `line-offer.ts` `lineOpener`):
libsodium's `crypto_scalarmult` for X25519 (what node's `diffieHellman` computes), and Web Crypto for HKDF-SHA256 and
AES-256-GCM, which libsodium's WebAssembly build doesn't have, so the caller hands in both (`SealCrypto`). On weft.zip
that's `libsodium-wrappers` and `crypto.subtle` (`lib/web-lines.ts`); the phone needs `react-native-libsodium` with
`crypto_scalarmult` and a Web Crypto `subtle` (a polyfill such as react-native-quick-crypto), and its RTCPeerConnection goes
into `openLine`. `lib/worker-seal-client.test.ts` opens a browser-sealed and a node-sealed offer with the worker's own
`open`, and refuses either under another purpose, another worker's key, a changed byte or a swapped ephemeral key.

- **What a line from weft.zip or the phone may do:** exactly what a row from there may do. The worker can't tell who sealed
  an offer (its key is public, so anyone with the session could), so a line proves only that the worker answers. Each verb
  on it passes the `host` kind's own checks (`remoteRefusal`, CardRules); a widening still needs its own fresh signed
  approval, which weft.zip never sends down a line (`lib/cloud-host-acts.ts` signs it on sign.weft.zip and sends a row); the
  terminal channel still needs the Mac's Touch ID key.
- **Who may open one:** only the worker's owner, by the insert policy that already gated the row
  (`private.owns_device`); `20261103150000_line_row_shape.sql` (applied) now holds a `line` row to the server's shape,
  since a browser builds it: a worker device, no folder, a payload of `sealed` (and the client hint) only, under 32 KB.
- **Which key it trusts:** `cloud_workers.public_key` as the visitor's session reads it, the same read the desktop's server
  makes. A key swapped in that row would get a line answered by whoever holds its private half, so such a line can do no more
  than the session it was opened with already can by rows.

## Sealed blobs

Status: **built for a Mac and the web board** (2026-11-03); a worker's in [Sealing on a Weft Worker](#sealing-on-a-weft-worker).
`lib/blob-seal.ts` on `lib/sync-seal.ts`'s `sealBytes` / `openBytes`.

A row that names a file names it by `blob:sha256:<hex>`, the hash of the plaintext, and the file sits in `weft-blobs` at
`<org>/<sha>`. When the row goes up sealed, the file goes up sealed too, with the same workspace key:

```
"wsb1" ‖ key version (u32, big-endian) ‖ 24-byte nonce ‖ XChaCha20-Poly1305(bytes, aad = "weft-blob-v1\n<org>\n<sha>")
```

- **The ref doesn't change.** Content addressing, dedup, every ref-walker (`collectBlobRefs`, `signPageAssets`, the show
  rail) and the R2 mirror work as before; only the bytes in the bucket are ciphertext. The content type stays the file's,
  so a reader that opens the bytes knows what it has; the type and the size are what the bucket learns.
- **Bound to where it sits.** The associated data names the org and the sha, so a server that moves a sealed object to
  another org or path gets bytes that won't open. Every reader also hashes what it opened and refuses it unless it is
  the ref's sha (`openBlob`), so a key holder can't put other content under a ref either.
- **Versioned.** Bytes without the `wsb1` magic are a plain blob from before sealing and pass through unchanged; a plain
  file that happens to start with the magic still opens, because its own hash is the ref's.
- **Who seals.** The Mac's outbox, through the blob store's `seal` argument (`createBlobStore` `upload` / `uploadPage` /
  `rewriteItem`), with `Sealer.blob(cardId)` (`lib/sync-seal-upload.ts`): the same switch, key and share rule as the rows,
  so a card with a share link keeps its files plain for `/s/…`. Each card gets its own view of the store
  (`withBlobSeal`) in `lib/cloud-sync-cards.ts` (thumbs, pages, tour pages) and `lib/cloud-sync-upload.ts` (what an item
  names). A **paired browser** (`lib/web-upload.ts`) holds a pasted file until its message goes, then seals it when the
  card it goes to came sealed with a key version this browser holds (`webBlobSeal`, which remembers each card's version
  as it draws the row), since that card's host provably holds the key; a worker's card, an unsealed or shared one and a
  new thread get it plain. A browser with no key puts at once, plain, as before.
- **Who opens.** A Mac receiving a pasted file (`lib/cloud-inbox-receive.ts`) opens it with main's current key
  (`macKeyring`, asked for only when something sealed arrives), and says which version it lacks when it can't. On
  weft.zip a paired browser opens pictures and thumbs itself (`lib/web-blob-open.ts` `openSealedUrls`: each signed URL is
  fetched and a sealed one becomes an object URL; one that can't be fetched or opened keeps its URL and draws broken, as a
  sealed row draws 🔒), and pages through `components/web-board/useSealedPage.ts`: the page route hands a sealed page over
  as stored (`?sealed=1`), the browser opens it and each `blob:sha256:` asset it names into a `data:` URL, and the pane
  frames it with `srcdoc` under the route's own sandbox (`allow-scripts allow-popups allow-forms`, no same-origin), so
  the page still runs in an opaque origin. The pane shows nothing while it looks, so ciphertext never flashes.
- **Servers draw the stand-in.** The web board's page route without `?sealed=1` and a share page (`lib/share-page-serve.ts`)
  serve the 🔒 page (`SEALED_PAGE_HTML`) for sealed bytes: they hold no key.
- **Write-once.** The bucket has no update policy, so the first upload of a sha wins. A file already up plain stays plain
  when a sealed row names it later (like old rows), and one that went up sealed stays sealed when a share link or a
  published mini app names the same bytes later: those draw the 🔒 stand-in until the page changes (a new sha).

## Sealing on a Weft Worker

Status: **built** (2026-11-03); migration `supabase/migrations/20261103090000_worker_key_grants.sql` (additive, applied by the
lead). Without a grant a worker publishes plain as before, and Settings → Devices says so. Two steps, each reusing a piece
already trusted: the pairing pins and the Mac's approval key from H8 and H10.

### Step A: a key grant to the worker

```
Settings → Devices → the worker → "Threads in the clear · Seal…"     (IPC worker-keys:grant, board window only)
main (electron/worker-key-grants.cjs):
        Seal synced threads is on? ─ the worker is yours and live (cloud_workers, main's own session)
        ─ paired (a pinned sign key) and its row's box key is the one pinned (electron/worker-pins.cjs)
        ─ Touch ID "give the worker m1mini the key to your sealed threads"
        ─ for each version main holds: sealed = seal(box key, key, "workspace-key:<org>:<worker>:<version>")
          (electron/worker-seal.cjs ≡ lib/worker-seal.ts: X25519 + HKDF + AES-256-GCM)
        ─ sig = this Mac's approval key (electron/desktop-signer.cjs) over
          "weft-worker-key-v1\n<org>\n<worker>\n<version>\n<box key>\n<sha256(sealed) hex>"
        ─ insert worker_key_grants { org_id, worker_id, version, box_key, sealed, mac_device, sig }   (RLS: the worker's owner)
        ─ remember the worker in ~/.weft/vault/worker-key-grants.json (safeStorage)
database: an insert pings the worker on worker-keys:<sha256("weft-worker-keys:" + key_hash)> (event key_grant)
worker (lib/worker-keyring.ts, lib/worker-key-grant.ts):
        worker_key_grants(p_key) ─ for each row: this worker and workspace ─ box_key is its own ─ sig by a Mac in
        macKeysAt(home).pinned() (the key from its pairing code; never one off the network) ─ opens under its purpose
        to 32 bytes ─ the ring, in memory only; read at start (before the daemon), on the ping and every 10 minutes
```

- **Never readable by weft.zip, never plantable.** The server stores a box sealed to a key it can't open, and the signature
  means a server (or the owner's stolen session) can't plant a key of its choosing. A worker enrolled by token trusts no
  Mac, so it takes no grant and stays plain; main refuses to grant one too. When PR #85's revocation lands, a revoked
  pairing Mac drops out of `pinned()` (`mac-revoked.json`), so its grants are refused on the next read.
- **The seal floor.** Once a worker has accepted a grant it writes `seal-floor.json` in its home (no key in it). From then
  on a worker with no key **holds** its rows and pages back instead of publishing plain, so a server that hides the grants
  (or a restart while offline) can't downgrade it to the clear. Deleting the file on the box goes back to plain on purpose.
- **Rotation.** main's `syncKeys.rotate` is wrapped in `electron/pairing-ipc.cjs`: after a phone's revoke rotates the key,
  every worker main granted whose box key is still pinned gets the new version (`regrant`). One whose pin went is dropped.
- **Revoke and Re-pin.** Revoking a worker (Settings → Devices) runs `device_revoke`, whose `revoked_at` trigger deletes
  its grants; the board then calls `worker-keys:drop`, which deletes them from main's side too and **rotates**, so what is
  sealed next is under a version the worker never had. Re-pin (`worker-pins:forget`) drops and rotates the same way, and
  says so if it couldn't. The worker's next read finds no grant and drops the key from memory.
- **Settings → Devices** folds the state into the worker's line (`lib/use-devices.ts` `sealLine`): "Threads sealed (key v3)"
  when its newest grant is the workspace's newest version, else "Threads in the clear · Seal…" (no grant, or an older
  version only, which a revoked device may hold).

**Migration:** `worker_key_grants (org_id, worker_id → cloud_workers on delete cascade, version, box_key, sealed, mac_device,
sig, granted_by, created_at; primary key (worker_id, version); (org_id, version) → workspace_keys)` with RLS select / insert /
delete for the worker's `owner_user` (insert also needs org membership and a live worker); `worker_key_grants(p_key)`
(security definer, keyed by `key_hash` through `worker_for_key`, nothing for a revoked worker); a trigger that deletes a
worker's grants when `cloud_workers.revoked_at` is set; and the `key_grant` ping trigger.

### Step B: the worker seals and opens

- **Seals its rows like a Mac's outbox.** `lib/worker-sealing-wire.ts` builds `makeSealer(s, newest key, isShared)` per
  flush (`lib/worker-sealing.ts`); the publisher (`lib/worker-publish.ts`) seals the card, its items and long tool results
  (`lib/worker-seal-rows.ts`) and hands `Sealer.blob(cardId)` to its blob store through `withBlobSeal`. A page opened in the
  pane (`lib/worker-pane.ts`) goes up sealed for its card. `worker_put_card` / `worker_put_items` store the sealed jsonb
  unchanged. A card with a share link stays plain. Session lines hear the rows plain: a line is end to end with the Mac.
- **Opens.** The worker's attachment reader (`openingReader`) runs a pasted file through `openBlob` before
  `receiveAttachments` checks the sha, and logs the version it lacks when it can't.
- **Boards open them.** The web board already opens any sealed row and blob with the workspace key. The desktop board
  opens a worker's rows on this Mac's own server (`lib/worker-board-open.ts`) with every version main holds
  (`POST /sync/keyring`, once a minute, asked only when something sealed comes by): cards (`readWorkerBoard`), thread pages
  (`workerThreadPage`), long tool results (`workerToolOutput`), pages (`workerPage`: the page opened and its sealed assets
  inlined as `data:` URLs, which the route's CSP allows; 🔒 when it won't open) and pictures (`workerBlobUrls`: a sealed one
  becomes a `data:` URL, each read once). ⌘F on a worker card (`lib/worker-thread-reads.ts`) reads the rows in batches,
  opens them and their cut tool results, and matches after opening, as weft.zip does; a 🔒 stand-in matches nothing.

**Threat model.** In scope: weft.zip's server, its database and backups, Weft's operators, a stolen account session, and
anyone holding the worker's `wwk_` key without its box. None of them reads a granted worker's sealed thread, its pages or
the files sent to it, plants a workspace key on the worker (no Mac signature), downgrades it to plain by hiding grants (the
seal floor), or gets a grant for a box they control (main seals only to the box key it pinned under Touch ID, and refuses
when the row's key changed). They can delete grants or stall the ping: denial of service, which holds the worker's rows.
Out of scope, as for a Mac: the worker box itself (whoever runs code there reads its memory, and its cards run with its
privileges), and a key the Mac granted before a revoke for rows sealed under that version.

**Not yet.** Files a Mac or a browser sends a worker's card still go up plain (`withAttachments` in `lib/worker-board.ts`,
`webBlobSeal`); the worker opens sealed ones already, so turning those on is the follow-up. Pairing a worker doesn't offer
Seal under its own Touch ID yet. A worker keeps sealing with the newest version it was granted, so if a regrant after a
rotation fails it seals under the older version until Seal… is pressed again (Devices shows it "in the clear").

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

## 4. Passkey approvals (H7)

Status: **built on the Weft side, not live** (2026-11-02). It ships once sign.weft.zip is set up (a Vercel domain, a
DNS record, a Supabase redirect URL) and migration `supabase/migrations/20261102130000_passkey_approvals.sql` is
applied. Until then nothing on weft.zip offers it.

A browser's localStorage key can't approve because any script on weft.zip could use it. A **passkey** can: WebAuthn
keeps the private key in the Secure Enclave (or the OS's passkey store), the page only gets a signature after Touch ID,
and the OS binds it to one site. That site is **not weft.zip**: an XSS anywhere on weft.zip could call
`navigator.credentials.get` itself, or show one thing and sign another. So passkeys live on their own origin.

### sign.weft.zip

`https://sign.weft.zip` is the same Next app, picked by host in `proxy.ts` (`lib/sign-origin.ts` `signRoute`): it serves
`/pair`, `/approve` and their two files (`/app.js`, `/app.css`), from `public/sign/`, and a 404 for every other path,
Next's own `/_next` files included. On every other host, weft.zip included, `/sign/*` is a 404. The pages are static
HTML with no inline script or style; `app.js` is `sign/main.ts` bundled by `scripts/build-sign.mjs` (run by
`pnpm build`; gitignored). Why not Next pages: `cacheComponents` (PPR) prerenders a shell whose inline scripts carry no
nonce, and Next's CSP guide (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`) says nonces and
PPR don't mix and there's no per-route opt-out. Every response on the host carries (`signCsp`):

```
default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:;
connect-src https://<project>.supabase.co wss://<project>.supabase.co; object-src 'none'; base-uri 'none';
frame-ancestors 'none'; form-action 'none'
```

plus `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer` and `Cross-Origin-Opener-Policy: same-origin`.
`'self'` is only these files, since the host serves nothing else; `'wasm-unsafe-eval'` is libsodium's WebAssembly (the
pairing claim). The pages sign in on their own origin (Supabase PKCE, GitHub); no token comes from weft.zip by URL or
`postMessage`.

### Pairing a passkey

Settings → Sync → **Pair a passkey** starts its own pairing session (`pairing.start(org, { passkey: true })`, its own
secret S) whose link is `https://sign.weft.zip/pair#…`, opened with **Open in browser** (no clipboard), or Copy link,
which clears the clipboard after a minute (`lib/clipboard-briefly.ts`). So S never reaches a weft.zip page. That page takes the link off the address bar, signs in, runs `navigator.credentials.create` (`lib/web-passkey.ts`:
rp id `sign.weft.zip`, ES256 only, `userVerification: "required"`, `residentKey: "preferred"`, attestation none), and
claims with `lib/web-sync-key.ts` `pairThisBrowser`. While it waits it shows a **code**, the first 4 bytes of
SHA-256 of the passkey's public key as `XXXX-XXXX` (`lib/passkey-code.ts`; main's copy in `electron/pairing-crypto.cjs`),
and the Mac's Touch ID prompt names the same code ("…only if sign.weft.zip shows the code XXXX-XXXX"). Anyone who got
the link first (a thread running `pbpaste`, a script reading the clipboard) and claimed with their own key makes the
Mac show a code the page doesn't. The claim gains `passkey_id` and `passkey_key` (SPKI, base64url)
as two more lines of the claim message, so the HMAC proof with S covers them. The Mac (`electron/pairing.cjs`) takes a
passkey **only** in a passkey session, and a passkey session only with one (`sessionProblem`): a phone or read-only
code, whose link opens on weft.zip, can't pin a passkey. Then Touch ID on the Mac ("pair the browser … with a passkey"),
and main pins `{ credId, publicKey, counter: 0 }` with the device in the sealed `paired-devices.json`. Main's `pin()`
refuses a device id already pinned with a different box key (the id comes from the server).

**Infrastructure rule.** sign.weft.zip is a domain on the weft.zip Vercel project's **Production** deployment only, never
a preview or branch alias, and Supabase's redirect URLs list exactly `https://sign.weft.zip/pair` and
`https://sign.weft.zip/approve`. `scripts/check-sign-host.mjs` checks the live host after a deploy.

**The trust shift.** The pages' code now decides what the user sees before Touch ID, so the weft.zip Vercel project and
its deploy pipeline (the repo, its CI, whoever can deploy) are trusted: a tampered `app.js` could show one real pending
request and have the passkey sign another real one for the same account. The Mac still refuses anything outside its own
rules (phone-only asks, grants, the origin, a stale or replayed answer), and still checks the signed request is the one
waiting.

**The pairing-time risk, plainly.** There's no attestation: the Mac can't tell a Secure Enclave key from a software
key a script made. A script running on sign.weft.zip/pair while the link is open could swap in its own key, and the Mac
would pin a key with no Touch ID behind it. That needs an XSS on sign.weft.zip itself, whose only code is these two
pages and their bundle, with no third-party script, no inline script and no other path; a weft.zip XSS never sees S.
The Mac's Touch ID still has to be given for the pairing.

### Approving

On the weft.zip board, an Allow on a permission request, when the account has a paired browser with a passkey
(`components/web-board/useSignWindow.ts`, from `public.devices`), opens `https://sign.weft.zip/approve?card=…&pending=…`
in a new top-level tab (`noopener,noreferrer`; never a frame) instead of sending. The board sends nothing; it sees the
card move on once the Mac has run the answer. That page (`lib/sign-approve.ts`) reads the card row itself, with its
own session, finds the waiting ask, builds the message, and draws the sheet (`lib/sign-sheet.ts`): the decision, the
tool, the folder (from the Mac's card), the card id, the input's size and line count, and the **whole input**, every
key, scrollable. Format characters (`\p{Cf}`: bidi overrides, zero-width, BOM) show as a visible ⟦U+XXXX⟧ mark and a
run of 8 or more spaces or tabs as ⟦N spaces⟧ (`lib/passkey-display.ts`). Allow stays off until a long input has been
scrolled to its end. Allow runs `navigator.credentials.get` with `challenge = SHA-256(message)`, `allowCredentials` =
this browser's credential and `userVerification: "required"`, and the page inserts the `answer` command with

```ts
auth: { kind: "webauthn", device, credId, issuedAt, authenticatorData, clientDataJSON, signature }  // base64url
```

**The message** (`lib/approval-passkey.ts` `passkeyMessage`) is its own encoding, separate from the phone's
newline-joined Ed25519 message (unchanged byte for byte): canonical JSON, keys sorted at every depth, of a fixed set of
keys, always all present: `v` (`weft-passkey-approval-v1`), `org`, `mac`, `card`, `pending`, `decision`, `issuedAt`,
`answers`, `folder`, `grant` (always null from a passkey, see below), `tool` and `input` (the whole tool input). No
value can forge another field, and the id fields refuse control characters, U+2028/9 and anything over 200
characters; the folder refuses control and bidi characters. Both refuse invisible and blank-looking characters (`\p{Cf}`,
line and paragraph separators, U+115F, U+1160, U+2800, U+3164, U+FFA0), and the sheet marks the same set in the input. `readPasskeyMessage` takes back only that shape, re-encoded
byte for byte; the sheet draws from it.

**The host's check** (`lib/approval-passkey-check.ts`, from `approvalProblem` when `auth.kind === "webauthn"`):

1. `issuedAt` within 5 minutes of the Mac's clock, and the pending request still waiting with that id.
2. **No folder grant**: a grant through a passkey (This card or Always on an outside-folder prompt) is refused. An
   Always would become a permanent read grant on a folder the sheet would have to explain well; grants stay on the
   phone or the Mac. Allow once still works.
3. Not a phone-only ask (`lib/passkey-phone-only.ts`): any `mcp__secrets__*` tool; turning permissions, approvals or the
   sandbox off (`bypassPermissions`, `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, Codex's
   `--yolo`, `--dangerously-bypass-approvals-and-sandbox`, `danger-full-access`, `-a`/`--ask-for-approval never`,
   `approval_policy=never`, `--full-auto`, Claude's `--allowedTools` with a wildcard, `GOOSE_MODE=auto`); writing an
   agent's config (`.claude`, `.codex` or `.goose` as a path segment or cd target, with or without a slash,
   `.claude.json`, `settings.local.json`, `.mcp.json`, git hooks, `hooksPath` anywhere, a `settings*.json` with
   `permissions` or `defaultMode`); or a path built from a variable or command (`$X`, `${X}`, `$(…)`) within 40
   characters of `claude`, `codex` or `goose`. The input is normalized first: escaped `\n` `\t` `\r` read as spaces,
   shell quotes, backslashes and `$'` stripped, whitespace collapsed, lowercased. **This rule is best-effort**: a shell
   can spell anything many ways (`${D}aude`, base64, a script it writes first). The main defence is the sheet showing
   the whole input the passkey signs.
4. No bidi override or isolate (U+202A–202E, U+2066–2069) anywhere in the input.
5. The input is exactly what the web showed: if the sync's redaction would change it (it looks like it holds a
   secret) or its canonical JSON is over 64 KB, the passkey is refused.
6. The message is rebuilt from **this Mac's own names**: its `lib/device-id.ts` id, the workspace the inbox has already
   checked the command against, the card's folder on this Mac, and its own pending request.
7. Main checks the assertion and keeps the counter in the same step (`POST /pairing/passkey-verify`,
   `electron/paired-devices.cjs` `verifyPasskey`, `electron/passkey-verify.cjs`, main's copy of `lib/passkey-verify.ts`;
   `electron/passkey-verify.test.ts` runs both over the same vectors): the device and credential pinned,
   `clientData.type === "webauthn.get"`, the origin exactly **`https://sign.weft.zip`** and not cross-origin,
   `rpIdHash === SHA-256("sign.weft.zip")` (no weft.zip fallback; a dev origin only as in Limits below), `challenge === base64url(SHA-256(message))`, the UP and UV flags, a sign counter that moves
   on (strictly greater than the pinned one whenever either is non-zero), and the ES256 signature (DER converted to raw
   r‖s) over `authenticatorData ‖ SHA-256(clientDataJSON)`. Both decoders take only canonical base64url.

**A behaviour change.** A paired browser with a passkey counts as an approver (`approvers()`), like a phone: once one
is paired, an unsigned Allow from the web is refused, and the host verbs that grant power are blocked from the web
(`ELEVATED_REFUSED`), unless **Approve from the web without a phone** is on.

**Limits.**
- **Synced passkeys.** iCloud Keychain, Google Password Manager and 1Password sync a passkey to every device in the
  account; each of them can then approve, and such passkeys report a sign counter of 0, so clone detection is off for
  them. The pin can't tell a synced passkey from a device-bound one (no attestation).
- **Labels.** The sheet shows ids, the tool, the input and the card's folder, all signed. A card's title and the
  synced card's other text aren't signed, and the server could relabel a card in the board's list; what the passkey
  signs is still exactly the request on the Mac.
- **Clipboard.** While any pairing code is open, the thread guards refuse Bash that reads the clipboard (`pbpaste`,
  `osascript` `the clipboard` / `clipboard as`, JXA `theClipboard`, NSPasteboard, `pboard`, `pyperclip`, `clipboardy`,
  `wl-paste`, `xclip`, `xsel`, matched after quotes, backslashes and `$''` are stripped, whitespace collapsed and case lowered;
  `lib/clipboard-guard.ts`, in `lib/guards/hooks.ts` so every CLI has it). Only main knows a code is open, so
  `electron/pairing.cjs` writes the latest open expiry to `vault/pairing-open.json` (`electron/pairing-open.cjs`; threads
  can neither read nor delete the vault folder) and removes it when the last code closes; a code left to expire leaves
  a past time, and Weft's start clears it. The guard reads the file only for a command that looks like a clipboard read.
  Best-effort (a script written to a file first isn't seen): the code match on the page and in Touch ID stays the defence.
  The QR is marked `data-secret` and Open in browser / Copy link `data-secret-action` (`components/PairDevices.tsx`), so a
  thread driving the board view (`electron/board-view.cjs`) gets the QR hatched in a screenshot and can't click them.
- **Dev origin.** Main takes one more origin only when Weft isn't packaged and both `WEFT_PASSKEY_DEV=1` and
  `WEFT_PASSKEY_DEV_ORIGIN` are set, and logs a warning at startup when it does (`passkeyDevOrigin`).
- **The weft.zip board** can be made to open the sign page for any card; the sheet still shows what that card's
  request is, and the user decides there.

### The desktop signs too

Goal (project-hosts.md, "Approvals and secrets"): every view produces the same signed approval, and a host has one verify
path. The Mac's own Touch ID (`promptTouchID`) approves but signs nothing. Three ways were weighed:

- **A Secure Enclave key in main.** The strongest key, but Electron has no API for it and nothing in the dependency tree
  reaches CryptoKit (`security` can't sign with an SE key); it would take a native module or a signed Swift helper to
  build, notarize and ship on every release. Not worth it while main already holds the vault and the pinned list.
- **The desktop opening sign.weft.zip/approve**, as the web board does. One more signer type for nothing: it puts the
  internet, Supabase and a browser tab in the path of a local Allow (slow, dead offline), and the desktop's answer
  doesn't go through the cloud inbox anyway.
- **Chosen: Touch ID, then main signs with a key only main holds** (`electron/desktop-signer.cjs`). An Ed25519 key, made
  on first use and sealed with safeStorage in `~/.weft/vault/desktop-sign-key.json`, where threads can't read it. It signs
  **the phone's message** (`lib/approval-sig.ts` `approvalMessage`; main's copy is proven byte for byte equal), so the
  auth is the phone's shape, `{ device, issuedAt, sig }`, with `device` this Mac's `lib/device-id.ts` id, and a host
  checks it on the same path: `approvalProblem` → `POST /pairing/verify` → `paired-devices.cjs` `verify`, which takes
  this Mac's own id against main's public key. That key is never pinned in the list, so it isn't an approver and turns
  nothing on. The trust is the same as the vault's: main, safeStorage and Touch ID; a thread can't reach the key, and
  it signs only over board-window IPC (`approval:sign`, `weft.approval.sign` in the preload), never the control server.

`approval:sign` takes `{ orgId, cardId, pendingId, allow, answers?, grant? }` (`electron/approval-sign.cjs`
`readSignRequest`; any other field, a label or a host, is dropped). **The prompt is main's own words**: main reads the
card from its own server (`GET /api/cards`), refuses a card it doesn't have or a request that isn't the one waiting, and
asks Touch ID with the card's title, the request's tool and what it runs (its command, file or url, one line, control
and format characters out), plus the grant. So a board-side script can't show "allow ls" over a request that runs
something else. It answers `{ device, issuedAt, sig, publicKey }`, or null when Touch ID is refused. Main signs only for
this Mac (the message's host is its own id); another host's card is refused until that host's requests are main's to read.

**Follow-up.** Nothing calls it yet. (1) The desktop board's Allow asks for the signature and sends it as `auth`, and
`card.permission.answer` runs `approvalProblem` on it. Which Allows take Touch ID is a product call: every one would slow
the board, so likely the phone-only asks (`lib/passkey-phone-only.ts`), folder grants, and any card on another host.
(2) A worker host pins the Mac's `publicKey` when it pairs (H10, one device registry), and main reads that worker's
pending request and its name from the registry, so a worker card's Allow from the desktop is signed for it and verifies there. Until then a remote host can't check a desktop signature.

### Values kept on a worker (H8, 2026-11-03)

"Keep on this worker" ([secrets.md](secrets.md#kept-on-a-worker)) follows this doc's rule that the vault and its grants
stay on the Mac or the phone. The desktop's device key signs each `vault_keep` (the values sealed to the worker's box
key, after Touch ID on the Mac), and the worker checks it against the Mac key its pairing code carried, never one off the
network. A kept value still opens only for a `secret_use` this Mac sealed and signed after its own Touch ID for that
use: no passkey, phone or web approval can start, widen or use one, since an `mcp__secrets__*` ask is phone-only
(`lib/passkey-phone-only.ts`) and the worker trusts only the pairing Mac's signature for a secret use.

## Tables (`supabase/migrations/*_mobile_security.sql`)## Tables (`supabase/migrations/*_mobile_security.sql`)

- `devices`: `kind text` (`desktop` default, `phone`, `browser`), `sign_key text` (Ed25519 public, phones only),
  platform also `ios`, `android`, `web`; a trigger refuses clearing `revoked_at`; `update (revoked_at)` granted on own rows.
- `phone_pairings`: `id`, `user_id`, `org_id`, `mac_device` (the Mac's `lib/device-id.ts` id), `mac_key`, `status`
  (`open` → `claimed` → `paired` | `cancelled`), `expires_at` (5 min), the claim (`name`, `platform`, `kind`,
  `box_key`, `sign_key`, `proof`, `sig`), `device_id`. RLS: the user's own rows; a claim only while `open` and unexpired.
- `workspace_keys` (`org_id`, `version`, `created_by`): one row per key version; members read, members insert.
- `workspace_key_grants` (`org_id`, `version`, `device_id`, `wrapped_key`, `granted_by`): a device's owner reads its
  own; a member inserts for the org; the granter or owner deletes.
- `cloud_commands` gains nothing: `auth` rides in `payload`.
- `*_passkey_approvals.sql`: `phone_pairings.passkey_id` / `passkey_key` (claimable, a check that both or neither are
  set and only by a browser) and the same two on `devices` (insert and select granted). They carry and record the
  passkey; the Mac's pin decides.

## Where it lives

- `lib/sync-seal.ts` — envelopes, AAD, seal/open for items, cards and tool outputs (isomorphic).
- `lib/approval-sig.ts` — the signed message, sign (for tests and the phone's copy) and verify.
- `lib/pairing-link.ts` — the QR link, its parsing, the claim string and its proof.
- `lib/approval-check.ts` — the inbox's rule above.
- `lib/passkey-verify.ts` — the WebAuthn assertion check (isomorphic Web Crypto); `lib/passkey.harness.ts` builds real
  test vectors.
- `lib/approval-passkey.ts` — the passkey message, its strict reader, `readPasskeyAuth`; `lib/passkey-phone-only.ts` —
  the phone-only rule; `lib/approval-passkey-check.ts` — the host's check; `electron/passkey-verify.cjs` — main's verifier.
- `lib/web-passkey.ts` — `createPasskey` / `signWithPasskey` in the browser; `lib/web-passkey-approval.ts` — what an
  Allow signs.
- `lib/sign-origin.ts` — sign.weft.zip's routes, CSP and approve link; `proxy.ts` applies them; `public/sign/` the pages,
  `sign/main.ts` their script (`scripts/build-sign.mjs`); `lib/sign-approve.ts` + `lib/sign-sheet.ts` +
  `lib/passkey-display.ts` the approve page; `components/web-board/useSignWindow.ts` the board's side.
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

- A Weft Worker seals only once you press Seal… for it (Settings → Devices); until then its rows and pages stay plain. A
  file a Mac or a browser sends a worker's card still goes up plain, though the worker opens sealed ones
  ([Sealing on a Weft Worker](#sealing-on-a-weft-worker), "Not yet").
- Sealed blobs: the phone app (weft-mobile) opens them only once it adopts `openBlob`; until then a phone draws a sealed
  picture broken. A sealed file is write-once under its sha (see [Sealed blobs](#sealed-blobs)), and a sealed page's
  `#anchor` is lost in `srcdoc`.
- Each Mac pins its own phones; a second Mac needs its own pairing, and has no way yet to get the workspace key (it
  uploads plain rows meanwhile).
- A browser's box and signing keys sit in localStorage, readable by any script on weft.zip; that's why only a passkey
  on sign.weft.zip approves. weft.zip itself still runs inline script (a nonce CSP isn't possible with PPR).
- The desktop board still approves with `promptTouchID` in Electron main, which signs nothing; signing there with a
  passkey (or a Secure Enclave key) would give the host one verify path for every view.
- A passkey can't sign an answer's elevated host verbs (`ELEVATED_REFUSED`); it signs a card's new folder, agent and a plain "!" line as a signed widening (project-hosts.md#signed-widening-as-built), never skipping prompts or a grant, and a browser paired before H7 has no
  passkey: it re-pairs to get one. The pairing doesn't check an attestation, so the Mac trusts that the key came from an
  authenticator on the strength of the QR secret and its own Touch ID.
- Old rows stay plain until their card changes; there's no backfill that reseals a workspace.
- The workspace key isn't in the shared vault's recovery words: lose every paired device and the Mac, and sealed
  history is gone (new rows still sync under a fresh key).
- A teammate's devices aren't granted the workspace key yet (a workspace is personal for sync today, cloud-sync.md).
