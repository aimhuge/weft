-- The Keychain audit log is kept in the database, not on the Mac (docs/architecture/secrets.md#audit-log): a file on
-- your own disk is one you can edit, so ~/.weft/vault/audit.jsonl is now only an outbox of lines not uploaded yet,
-- and lib/keychain-audit-sync.ts deletes each line from it once it's here. What's here can't be changed or taken
-- back (no update or delete policy), and these two columns make what happened before upload show:
--
-- - created_at is the database's own clock, whatever the Mac sends, so a line held back shows how late it came.
-- - seq numbers each Mac's lines 1, 2, 3… (electron/keychain-audit.cjs), so a line removed from the outbox before
--   it went up is a gap Settings → Security points out. A Mac can't send the same number twice.
--
-- The table had no rows when this ran, so seq and device_id go straight to not null.

alter table public.keychain_events
  add column seq bigint not null check (seq > 0),
  alter column device_id set not null;

create unique index keychain_events_device_seq on public.keychain_events (user_id, device_id, seq);

create or replace function private.keychain_events_server_time()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

create trigger keychain_events_server_time
  before insert on public.keychain_events
  for each row execute function private.keychain_events_server_time();
