-- Wakes a Weft Worker the moment a command lands for it (docs/architecture/weft-worker.md). A worker holds no session,
-- so postgres_changes shows it nothing and it used to ask every 3 s. Now this trigger sends a Realtime Broadcast ping
-- on a public channel the worker joins with the publishable key, and the worker asks at once.
--
-- A public channel needs no sign-in, so the topic is the only secret. It's derived from key_hash, which only the
-- worker can compute (sha256 of its key) and no client can read: the column grant leaves it out, and Realtime refuses
-- it in a row payload or a filter. A ping carries nothing, so a leaked topic gives away when commands arrive and lets
-- someone cause polls, never a command: those are still read through the key-checked worker_pending.
create or replace function private.worker_wake_topic(p_key_hash text)
returns text
language sql
immutable
set search_path = ''
as $$ select 'worker-wake:' || private.sha256_hex('weft-worker-wake:' || p_key_hash); $$;

-- Pings only for a command worker_pending would return, so a human's row for a Mac sends nothing. Definer, because
-- the sender can't read key_hash. realtime.send swallows its own errors, so a ping can't fail the insert.
create or replace function private.cloud_commands_wake_worker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hash text;
begin
  select w.key_hash into hash from public.cloud_workers w
    where w.org_id = NEW.org_id and w.kind = 'headless' and w.owner_user = NEW.created_by
      and 'worker:' || w.id::text = NEW.target_device;
  if hash is not null then
    perform realtime.send('{}'::jsonb, 'wake', private.worker_wake_topic(hash), false);
  end if;
  return NEW;
end;
$$;

revoke all on function private.worker_wake_topic(text) from public, anon, authenticated;
revoke all on function private.cloud_commands_wake_worker() from public, anon, authenticated;

create trigger cloud_commands_wake_worker
  after insert on public.cloud_commands
  for each row
  when (NEW.status = 'pending' and NEW.target_device like 'worker:%')
  execute function private.cloud_commands_wake_worker();
