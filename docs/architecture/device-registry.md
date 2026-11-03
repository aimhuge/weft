# One device registry and one pairing flow (H10)

Status: **built on the Weft side, not applied** (2026-11-02). Migration
`supabase/migrations/20261102150000_device_registry.sql` is written and checked against a local Postgres 17, not applied.
Until it is, Settings → Devices says it couldn't read the registry, Add a worker's code can't be opened, and everything
else runs as before. Phase H10 of [project-hosts.md](project-hosts.md#devices-and-records).

## Before

Three registries, three flows:

| registry | holds | made by |
|---|---|---|
| `public.devices` | Macs' vault keys (X25519), paired phones (box + Ed25519 sign key) and browsers (box key, H7's passkey) | the Mac registering itself (`electron/device-key.cjs`); the Mac confirming a phone's QR claim (`electron/pairing.cjs`) |
| `public.cloud_workers` | headless workers (`key_hash`, the seal key as `public_key`) and `desktop` heartbeat rows | `worker_enrol` trading a one-time token (`install/worker.sh`); `desktop_worker_beat` |
| `public.phone_pairings` | one QR code's life and the claim | the Mac (open), the phone (claim), the Mac (paired) |

## The registry

`public.device_registry` is a **view**, not a new table, so nothing moves and every existing writer (the phone app's
claim, the Mac's `devices` insert, `worker_enrol`, `desktop_worker_beat`) keeps working unchanged. One row per device:

| column | Mac | worker | phone / browser |
|---|---|---|---|
| `id` | its `devices` row (or its heartbeat row when it has no key row yet) | its `cloud_workers` row | its `devices` row |
| `kind` | `mac` | `worker` | `phone` / `browser` |
| `owner_user`, `org_id` | the user; the heartbeat's org | the enroller; its org | the user; the org it paired into |
| `box_key`, `sign_key`, `passkey_id`/`passkey_key` | vault key | seal key; Ed25519 when paired | box + sign key; passkey (browser, H7) |
| `host` | its `lib/device-id.ts` id | `worker:<id>` | null |
| `key_device`, `worker_id` | both, merged | `worker_id` | `key_device` |
| `status`, `last_seen_at`, `revoked_at` | either row's | its row's | its row's |

- **A Mac is one row.** Its key row and its heartbeat row are joined by `devices.host_device`, the Mac's device id, which
  `electron/device-beat.cjs` `linkHost` writes once per launch (the migration fills it for every Mac that ever opened a
  phone pairing, whose row named both). A Mac whose key row isn't linked yet shows its heartbeat row alone.
- **`security_invoker = true`**: the view reads each table as the caller, so its RLS and column grants decide what shows
  (your own `devices` rows and the ones a vault you're in was granted; your workspaces' workers; your own pairings).
  `key_hash` and wrapped keys are never selected. Anon can't read it; authenticated can only select.
- **Workers get no `devices` row.** Code that wraps a key "to every device of yours" (the vault's rotate, a grant
  picker) reads `devices`; a worker there would be handed the vault key. Keeping them in `cloud_workers` and only
  *viewing* them together is what keeps any device from gaining a capability.

Readers: Settings → **Devices** (Revoke is an elevated route: Weft's own window only, never a thread's curl) (`components/DevicesSettings.tsx` → `lib/use-devices.ts` → `GET /api/devices` →
`lib/device-registry.ts`), and the revoke below. The board's worker tiles still read `cloud_workers`
(`lib/worker-board.ts`, left to the H4/H5 board work); a revoked worker there reads offline, since its key no longer beats.

## One revocation

`device_revoke(id)` takes any registry id, owner only, and returns the kind:

- **worker**: `revoked_at`, `status = offline`, and `key_hash` replaced with `revoked:<uuid>`. Every key check finds
  nothing, with no reader changed: `private.worker_for_key` (every `worker_*` RPC), the `worker-blob` and `worker-build`
  routes (`.eq("key_hash", …)`), the wake and presence topics (derived from the hash).
- **Mac**: its key row's `revoked_at` (RLS already keeps a revoked device from its vault grants), its workspace-key grants
  dropped, and its heartbeat row revoked. A `before insert` trigger on `cloud_workers` refuses a heartbeat row for a device
  id whose key row or earlier heartbeat row was revoked, so `desktop_worker_beat` fails instead of showing it online
  again, whatever that function becomes; and "delete own" no longer covers a revoked Mac's row, so it can't be removed to
  make room for a fresh one.
- **phone / browser**: `revoked_at` and its workspace-key grants dropped. Settings → Devices sends a phone or browser
  **this Mac pinned** to `window.weft.pairing.revoke` instead (`revokeRoute`), which also unpins it here and rotates the
  workspace key, as before.

`cloud_workers` gains a keep-revoked trigger like `devices`': no update touches a revoked row (a stolen session or the
worker's own key can't bring it back). Remove (delete) still works for workers, revoked or not.

Only a device row's own user may change its `host_device` (a `before update` trigger): an org admin can update a device
row through the "devices: admin revoke" policy, and must not point it at another Mac's host row.

## Enrolling a worker is pairing a host

Settings → Devices → **Add a worker** runs the phone's steps for a box:

```
 Mac (main)                          Supabase                                   Box (weft-worker enrol)
 S = 32 random bytes (memory only)
 worker_pair_open(org, mac id, key) ─▶ phone_pairings purpose=worker, 1 h
 shows: curl … | sh -s -- wph.<pairing>.<org>.<S>
                                                                        ◀── makes wwk_ key K, Ed25519 sign key,
                                                                            uses its seal key as box key
                                      ◀── worker_pair_claim(box, sign, sha256(K), name, platform, arch,
                                            proof = HMAC(S, claim), sig = Ed25519(claim))   (anon)
                                                                            prints check code XXXX-XXXX
 poll sees claimed; checks proof with S and sig with sign key
 Touch ID: add the worker "m1mini" … only if it printed XXXX-XXXX
 worker_pair_confirm(pairing, the hash and keys it checked) ─▶ cloud_workers row (same as worker_enrol's + sign_key)
                                      ◀── worker_pair_status(pairing, K): paired, worker id, org, device
                                                                            writes worker.json; key-checked as before
```

- The claim message is `weft-host-pair-v1\n<pairing>\n<org>\n<box>\n<sign>\n<key hash>\n<name>\n<platform>\n<arch>`
  (`lib/host-pairing.ts`, main's copy `electron/host-pairing.cjs`); the proof is HMAC-SHA-512-256 (libsodium's
  `crypto_auth` bytes) and both sides use Node's crypto. The check code is 4 bytes of the claim's SHA-256: someone
  who claimed the code first makes the Mac show a code the box didn't print.
- **The key never crosses the network to be issued**: the box makes `K` and sends only its hash. The worker's identity
  stays a key checked by sha256 in `worker_for_key`. The hash sits on the pairing row (which its owner can read) only
  between the claim and the confirm, which clears it; after that `worker_pair_status` checks the worker's own row, whose
  `key_hash` no client reads (the wake and presence topics derive from it).
- `purpose` is set only by `worker_pair_open` (no column grant), and a check constraint keeps a device pairing from
  ever being claimed as a worker and a worker pairing from being claimed as anything else. `worker_pair_confirm` takes
  back the hash and keys main checked, so a row changed after the check doesn't match; it works once, only for the
  pairing's owner, while they're still in the workspace.
- `install/worker.sh` is unchanged apart from its help line: it passes whatever it's given to `weft-worker enrol`,
  which pairs for a `wph.` code (`lib/worker-pair.ts`) and trades a `wet_` token as before (`lib/worker-registry.ts`).
- An enrolled box pairs again only on an approval its trusted Mac signs: Settings → Devices → **Re-pair**
  (`worker-repair:approve`, [project-hosts.md](project-hosts.md#re-pairing-a-worker)).
- IPC `host-pairing:start|check|cancel` is registered by `electron/pairing-ipc.cjs` on the same board-only handler as
  phone pairing (`electron/host-pairing-ipc.cjs`), sharing its view of this Mac and its Touch ID.

## The pairing Mac

Built 2026-11-03 with `supabase/migrations/20261103080000_worker_pairing_mac.sql` (not applied). A paired worker trusts one
Mac: the one whose approval key came in its pairing code (`lib/worker-mac-keys.ts`, `mac-keys.json`). With two Macs signed
in, its asks used to go to the newest heartbeat, which then couldn't answer (the worker refuses another Mac's `secret_use`,
and main answers vault asks only from a worker it pinned).

- **`cloud_workers.paired_mac`** is that Mac's device id, copied from the pairing row by a trigger when
  `worker_pair_confirm` marks it paired (no client may write it; filled for every worker paired before). It's routing only:
  the worker still checks every answer against the key it pinned, so a wrong value at worst sends an ask where nobody can
  answer it.
- **`worker_secret_ask` and `worker_mac_ask`** send secret runs and the vault's asks (`vault_*`, `dev_env`) only to that Mac
  while it beat in the last minute, and return null when it's away; the worker says so ("secrets come only from the Mac
  it's paired with", `lib/worker-secret-run.ts`, `lib/worker-mac-ask.ts`), and `weft-worker status` names the Mac's key
  fingerprint. A tunnel or relay, which any of your Macs may approve, tries the paired Mac first and falls back to the
  newest beat. A token-enrolled worker (no pairing) keeps the newest beat. A revoked Mac's beat never counts.
- **Limits.** The paired Mac must beat in the worker's own workspace (as before, the heartbeat row is per workspace the Mac
  syncs to). A Mac that changed device id (revoked, then registered afresh) is a different Mac: re-pair.

## Revoked on one device, untrusted on all

Built 2026-11-03. `device_revoke` only marks rows; what decides trust is each pin list. Each now follows the registry, and
only ever takes trust away from it:

- **Phones and browsers on the Mac that paired them.** `electron/pairing.cjs` `reconcile()` reads `revoked_at` for every
  device in `paired-devices.json` (at most once a minute, from the passkey sync every 30 s) and treats one revoked
  elsewhere as `pairing:revoke` would: unpinned (its signatures stop counting), its grants dropped and the workspace key
  rotated. Only a row that says `revoked_at` counts: a row missing from the read (RLS, another account signed in) unpins
  nothing.
- **Passkeys and phones on workers.** The same refresh then narrows each worker's endorsed set to the passkeys and phones
  still pinned here (a phone approves Allows there once endorsed, mobile-security.md "Phones on a worker")
  (`electron/widen-endorse.cjs`), and the worker refuses a passkey while its set is older than the head the Mac
  published ([weft-worker.md, passkey heads](weft-worker.md#passkey-heads-a-worker-never-approves-with-an-outdated-set),
  `lib/passkey-head.ts`).
- **The pairing Mac on its workers.** `worker_mac_state(key)` says whether the worker's `paired_mac` was revoked (its
  heartbeat row, or a key row naming it as `host_device`). The daemon checks at start and every minute
  (`lib/worker-mac-revocation.ts`, from `lib/worker-host-services.ts`) and marks every key it pinned revoked in
  `mac-revoked.json`, for good: `macKeysAt().pinned()` leaves them out, so no secret answer, synced setting, endorsement,
  widening or re-pair approval signed by that Mac counts again, even after a re-pair from it. The passkeys it endorsed
  earlier stay as they are (no newer set can reach them). `held()` still counts the revoked key, so a count of who could
  approve (h7's `approvers()`) must use `held()`, not `pinned()`: a revoked Mac mustn't lower the bar to "nothing paired".
  The box then takes no secrets until it's wiped and enrolled from another Mac
  ([weft-worker.md](weft-worker.md#re-pairing-and-a-lost-mac)).
- **Threats checked.** A stolen session can revoke any of your devices already, so a false "revoked" costs only that
  device, never adds one. It can't un-revoke (the keep-revoked triggers) or write `paired_mac`, and a failed read changes
  nothing. A read that can't see a phone's row leaves it pinned (not fail-closed: an account switch would otherwise unpin
  everything).

## Versions

Settings → Devices shows the Weft version and commit each device runs in its existing subtitle ("Worker · paired · Busy · 0.7.0 (d9b7166)"), and marks one older than the newest version across your devices ("0.6.6 (abc1234, older)"). No "N behind main": that needs GitHub, so it isn't computed.

- A **worker** publishes `cloud_workers.build` ("0.6.6+abc1234") through `worker_set_build`.
- A **Mac** writes the same string, plus `build_channel` (release or dev), on its own heartbeat row once a day through `desktop_set_build`, from `lib/app-version-sync.ts` beside `app_version_submit` (which now takes the commit too). The commit is `NEXT_PUBLIC_APP_COMMIT`, read from git by `next.config.ts` at build time; empty when there is no checkout.
- `device_registry` carries `build` and `build_channel`; `lib/device-version.ts` parses and formats them.
- **Phones and browsers** report nothing, so they show no version.
- The admin Users page (`/admin/users`) has a Version column (each account's devices, filterable) and the distribution across all accounts per version and channel in its subtitle, from `admin_device_versions` (service role).

Migration `20261102290000_device_versions.sql`.

## Left on the old paths, and why

- **`worker_enrol_token` / `worker_enrol`** stay: Settings → Sync → Workers still offers a token, and installs already
  out there use it. Same capability as pairing (a signed-in session can make a worker either way); pairing adds the
  Mac's check and Touch ID and keeps the key off the wire.
- **`desktop_worker_beat`** stays as is (H5's heartbeat). The registry merges its rows instead.
- **Phone and browser pairing** (`electron/pairing.cjs`, `lib/pairing-link.ts`) are unchanged: the phone app writes
  `phone_pairings` and `devices` exactly as before, and H7 is changing those files.
- **A revoked Mac** can't beat under its device id, unwrap vault or workspace keys, or be paired with under that key. It
  still holds the account's session, which no device revocation can take away: with it, it can register a new key row,
  mint a new device id and beat as a new Mac, and act as the account (sync, commands) as any signed-in client can.
  Signing that account out everywhere (rotating its sessions) is what ends that.
- **A Mac's approval key isn't a `devices` column.** `devices` holds each Mac's X25519 vault key, which any signed-in
  session can add, so nothing that needs a Touch ID-backed yes may trust a row there. The Ed25519 desktop approval key
  (`electron/desktop-signer.cjs`) reaches a worker only in its pairing code, and weft.zip's connectors keep their own list
  of it, `connector_signers`, trusted once the link emailed to the account is opened or a trusted Mac vouches for it
  ([connectors.md](connectors.md#who-may-say-yes-the-chain-of-trust)).
- **Worker keys aren't pinned on the Mac**: `sealTarget` (`lib/workers-account.ts`) still reads the worker's box key
  from its row. The pairing checked that key; pinning it locally is H8's to use.

## Tests

`lib/device-registry.test.ts`, `lib/host-pairing.test.ts` (main's check against the box's claim, every refused field),
`lib/worker-pair.test.ts`, `lib/use-devices.test.ts`, `components/DevicesSettings.test.tsx`,
`electron/host-pairing.test.ts`, `electron/host-pairing-ipc.test.ts`, `electron/device-beat.test.ts`,
`app/api/devices/route.test.ts`. The migration was applied to a scratch Postgres 17 over stand-ins for the tables it
touches (twice, and after H7's `20261102130000_passkey_approvals.sql`), and a 73-assertion SQL script ran every branch of
the view, `device_revoke`, the keep-revoked trigger, the pairing functions and the phone flow as `anon` and
`authenticated`.

The pairing Mac and cross-device revocation: `lib/worker-mac-keys.test.ts`, `lib/worker-mac-revocation.test.ts`,
`lib/worker-host-services.test.ts`, `lib/worker-secret-wiring.test.ts`, `electron/pairing.test.ts` (reconcile),
`electron/pairing-ipc.test.ts`. Both 2026-11-03 migrations were applied twice to a scratch Postgres 17 over stand-ins, and
a SQL script checked routing (paired Mac first, away, revoked, a token worker, the tunnel fallback), the backfill,
`worker_mac_state` both ways, and the heads table's grants, prune, cap and cascade.
