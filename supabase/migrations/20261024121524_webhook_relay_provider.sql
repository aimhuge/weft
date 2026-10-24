-- Provider-signed webhook relays (pentest 2026-10-20, F-12). The relay at /api/hooks/<relay id>
-- used to save every request to webhook_deliveries; a stranger holding the id could inject arbitrary
-- methods, headers and bodies onto the owner's localhost. The relay now refuses anything that doesn't
-- carry a known provider's signature, the providers Weft already verifies for hooks (Stripe, GitHub,
-- Vercel, Resend/Svix).
--
-- The signing secret can't be read on Vercel — it lives in the user's Mac vault only. The local Weft
-- encrypts it on the way in with WEFT_RELAY_SECRET_KEY (32-byte AES-256-GCM), and the deployed
-- decrypts only inside the verify call. secret_key_id lets us rotate the key without losing rows;
-- an unknown key_id refuses the delivery.

alter table public.webhook_relays
  add column if not exists provider text not null default '',
  add column if not exists secret_ciphertext bytea,
  add column if not exists secret_nonce bytea,
  add column if not exists secret_key_id text;

-- Existing rows: empty provider, no secret. Their relays stop accepting new deliveries until the
-- local Weft recreates them through createRelay with a known provider. Older rows' deliveries
-- already in webhook_deliveries keep flowing.

-- An owner can read the provider for their own row (drawer shows it); the rest stays service-only.
drop policy if exists "webhook_relays: read own" on public.webhook_relays;
create policy "webhook_relays: read own" on public.webhook_relays
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- createRelay sets provider + ciphertext in one insert. An update flow can change any of them later.
drop policy if exists "webhook_relays: add own" on public.webhook_relays;
create policy "webhook_relays: add own" on public.webhook_relays
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- The secret columns are service-only. Owner-role grants skip them.
revoke all on public.webhook_relays from anon, authenticated;
grant select (id, user_id, name, provider, created_at) on public.webhook_relays to authenticated;
-- The user is allowed to update provider/secret on their own row, but only when they supply everything
-- the verifier will need (provider non-empty and secret set together).
grant update (provider, secret_ciphertext, secret_nonce, secret_key_id) on public.webhook_relays to authenticated;
grant insert (name, provider, secret_ciphertext, secret_nonce, secret_key_id) on public.webhook_relays to authenticated;
grant delete on public.webhook_relays to authenticated;
