-- The Keychain audit log, off the Mac (docs/architecture/secrets.md#audit-log): every time Weft opened something it
-- keeps in the macOS Keychain, and every time a 🔐 vault value was revealed, copied, typed into a page, run with,
-- pushed or written, by you, a thread or Weft itself. Electron main writes each event to ~/.weft/vault/audit.jsonl
-- first; lib/keychain-audit-sync.ts uploads it here while you're signed in, so a copy outlives the Mac and nothing
-- on the Mac can take a line back. Names and events only, never a value or a ciphertext.
--
-- id is the line's own id from the Mac, so a retried upload is a conflict that does nothing, never a duplicate.

create table public.keychain_events (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The Mac it came from (lib/device-id.ts).
  device_id    text check (char_length(device_id) <= 80),
  occurred_at  timestamptz not null,
  kind         text not null check (kind in ('keychain', 'vault')),
  action       text not null check (char_length(action) between 1 and 40),
  outcome      text not null check (char_length(outcome) between 1 and 20),
  -- you, thread, app or weft.
  actor        text not null check (char_length(actor) between 1 and 20),
  -- The Keychain item ("Vercel token"), on a keychain event.
  what         text check (char_length(what) <= 80),
  card         text check (char_length(card) <= 80),
  thread       text check (char_length(thread) <= 300),
  vault        text check (char_length(vault) <= 300),
  names        text[] not null default '{}' check (cardinality(names) <= 50),
  environment  text check (char_length(environment) <= 60),
  site         text check (char_length(site) <= 300),
  command      text check (char_length(command) <= 300),
  detail       text check (char_length(detail) <= 300),
  -- How it was allowed: grant, touch-id, unlocked, rule, once, always.
  via          text check (char_length(via) <= 20),
  -- On a keychain event: how many more times Weft did the same in the ten minutes after it.
  repeat_count integer not null default 0 check (repeat_count >= 0),
  created_at   timestamptz not null default now()
);

create index keychain_events_user_time on public.keychain_events (user_id, occurred_at desc);

alter table public.keychain_events enable row level security;

-- Append-only for its owner: read and add your own lines; no update or delete policy, so nobody signed in can
-- change or remove one.
create policy "keychain_events: read own" on public.keychain_events
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "keychain_events: add own" on public.keychain_events
  for insert to authenticated
  with check (user_id = (select auth.uid()));
