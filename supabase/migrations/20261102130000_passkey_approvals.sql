-- Passkey approvals from a paired browser (docs/architecture/mobile-security.md, "Passkey approvals").
-- A browser pairing can carry a WebAuthn passkey: its credential id and P-256 public key (SPKI, base64url), inside
-- the claim the HMAC proof covers. The Mac checks the claim, asks Touch ID and pins the passkey itself
-- (~/.weft/vault/paired-devices.json); these columns only carry it there and record it, they never decide whose
-- signature counts.

-- ── phone_pairings: the claim may name a passkey ────────────────────────────
alter table public.phone_pairings add column if not exists passkey_id text check (char_length(passkey_id) <= 1400);
alter table public.phone_pairings add column if not exists passkey_key text check (char_length(passkey_key) <= 400);
-- Only a browser pairs with a passkey, and it names both halves or neither.
alter table public.phone_pairings drop constraint if exists phone_pairings_passkey_check;
alter table public.phone_pairings add constraint phone_pairings_passkey_check
  check ((passkey_id is null) = (passkey_key is null) and (passkey_id is null or kind = 'browser'));
grant update (passkey_id, passkey_key) on public.phone_pairings to authenticated;

-- ── devices: what a paired browser's row records ────────────────────────────
alter table public.devices add column if not exists passkey_id text check (char_length(passkey_id) <= 1400);
alter table public.devices add column if not exists passkey_key text check (char_length(passkey_key) <= 400);
alter table public.devices drop constraint if exists devices_passkey_check;
alter table public.devices add constraint devices_passkey_check
  check ((passkey_id is null) = (passkey_key is null) and (passkey_id is null or kind = 'browser'));
grant insert (passkey_id, passkey_key) on public.devices to authenticated;
grant select (passkey_id, passkey_key) on public.devices to authenticated;
