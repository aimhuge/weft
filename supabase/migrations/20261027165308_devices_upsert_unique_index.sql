-- The devices unique index was partial (WHERE user_id IS NOT NULL) so that the
-- recovery device row (user_id IS NULL) could exist alongside a user's own
-- devices with the same public_key. Postgres cannot use a partial index as an
-- ON CONFLICT target, so the desktop's device upsert failed with 42P10.
--
-- NULLS NOT DISTINCT (Postgres 15+) gives us both: NULL user_ids still never
-- collide with each other, and the index is a valid inference target.
drop index if exists public.devices_user_pubkey_idx;

create unique index devices_user_pubkey_idx
  on public.devices (user_id, public_key) nulls not distinct;
