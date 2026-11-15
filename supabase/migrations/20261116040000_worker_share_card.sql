-- A thread on a Weft Worker shares its own card (docs/architecture/sharing.md#share_card-a-thread-shares-its-own-card).
-- On a Mac, mcp__board__share_card writes cloud_shares through the signed-in account (lib/card-share.ts), as the Share
-- dialog does. A worker holds no account session, only its key, so it asks this function instead.
--
-- What a worker may do, and nothing more:
--   - only its own card: a live cloud_cards row this worker published (owner_worker = the worker), in its workspace;
--   - only 'public' or 'private': no email gate and no password (a worker never handles a password's hash);
--   - created_by is the worker's owner, as if the owner's Mac had made the link, so the address is theirs
--     (weft.zip/@<owner>/threads/<slug>) and the Mac's Share dialog sees and changes the same row;
--   - an existing row keeps its id and slug; the mode and show_chat change, and a password set from the Mac is dropped.
-- The consent is the thread's side: the board asks the user once per card before the first public share
-- (lib/share-consent.ts). The slug candidates come from the card's title on the worker (lib/card-share-slug.ts) and
-- the first free one is taken; none free leaves the link at /s/<id>.
create or replace function public.worker_share_card(p_key text, p_card_id text, p_mode text, p_show_chat boolean, p_share_id text, p_slugs text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
  v_row public.cloud_shares;
  v_slug text;
  v_username text;
begin
  if w.revoked_at is not null then
    raise exception 'this worker was revoked' using errcode = '28000';
  end if;
  if p_mode is null or p_mode not in ('public', 'private') then
    raise exception 'a worker shares a card as public or private only' using errcode = '22023';
  end if;
  if not exists (select 1 from public.cloud_cards c
                 where c.org_id = w.org_id and c.card_id = p_card_id and c.owner_worker = w.id and c.deleted = false) then
    raise exception 'card not published yet' using errcode = 'P0002';
  end if;

  select * into v_row from public.cloud_shares s where s.org_id = w.org_id and s.card_id = p_card_id;
  if v_row.id is null then
    if p_share_id is null or p_share_id !~ '^[A-Za-z0-9_-]{16,32}$' then
      raise exception 'bad share id' using errcode = '22023';
    end if;
    insert into public.cloud_shares (id, org_id, card_id, mode, show_chat, created_by)
      values (p_share_id, w.org_id, p_card_id, p_mode, coalesce(p_show_chat, false), w.owner_user)
      returning * into v_row;
  else
    update public.cloud_shares s
      set mode = p_mode,
          -- Leaving the password gate drops the old hash, as lib/card-share.ts changeFor does.
          password_hash = null,
          show_chat = coalesce(p_show_chat, s.show_chat)
      where s.id = v_row.id
      returning * into v_row;
  end if;

  -- The first free slug, as claimThreadSlug does on a Mac; the unique index is per creator.
  if v_row.slug is null and p_slugs is not null then
    foreach v_slug in array p_slugs[1:9] loop
      continue when v_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$';
      begin
        update public.cloud_shares set slug = v_slug where id = v_row.id returning * into v_row;
        exit;
      exception when unique_violation then
        null;
      end;
    end loop;
  end if;

  select p.username into v_username from public.profiles p where p.id = w.owner_user;
  return jsonb_build_object('id', v_row.id, 'mode', v_row.mode, 'slug', v_row.slug, 'show_chat', v_row.show_chat,
                            'username', v_username);
end;
$$;

revoke all on function public.worker_share_card(text, text, text, boolean, text, text[]) from public;
grant execute on function public.worker_share_card(text, text, text, boolean, text, text[]) to anon, authenticated;
