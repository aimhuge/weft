-- A `line` row's exact shape (docs/architecture/project-hosts.md#the-session-line-h6-as-built), now that weft.zip and the
-- phone seal their own offers and insert the row with the visitor's session (lib/web-lines.ts, @weft/client lineOpener)
-- instead of this Mac's server building it (lib/worker-board.ts openWorkerLine).
--
-- Who may insert one is unchanged: "cloud_commands: insert as member" already lets only the worker's owner address its
-- device (private.owns_device, 20261030093258), as created_by. What changes is who builds the row, so the database now
-- holds it to what the server always sent: addressed to a worker, no folder, and a payload of the sealed offer (and the
-- sender's client hint) only, small. The worker opens nothing else (lib/worker-kinds.ts line → sealedOf), so this only
-- keeps junk out of the queue and the Realtime stream; the sealed offer itself is what proves the worker answers.
--
-- Additive and NOT VALID: rows already in the table aren't rechecked, every new or updated `line` row is.
alter table public.cloud_commands drop constraint if exists cloud_commands_line_shape;
alter table public.cloud_commands add constraint cloud_commands_line_shape check (
  kind <> 'line' or (
    target_device like 'worker:%'
    and folder = ''
    and jsonb_typeof(payload) = 'object'
    and (payload - 'sealed' - 'client') = '{}'::jsonb
    and jsonb_typeof(payload -> 'sealed') = 'object'
    and (payload -> 'sealed') ?& array['v', 'epk', 'iv', 'ct', 'tag']
    and ((payload -> 'sealed') - 'v' - 'epk' - 'iv' - 'ct' - 'tag') = '{}'::jsonb
    and (payload -> 'sealed' -> 'v') = '1'::jsonb
    and jsonb_typeof(payload -> 'sealed' -> 'epk') = 'string'
    and jsonb_typeof(payload -> 'sealed' -> 'iv') = 'string'
    and jsonb_typeof(payload -> 'sealed' -> 'ct') = 'string'
    and jsonb_typeof(payload -> 'sealed' -> 'tag') = 'string'
    and octet_length(payload::text) <= 32768
  )
) not valid;
