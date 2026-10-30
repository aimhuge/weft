-- A worker card's page (docs/architecture/weft-worker.md#pages-from-a-worker): worker_put_card fills the columns a
-- phone feed reads (cloud_cards.page and .pages, docs/architecture/cloud-sync.md#the-cards-page) from the card it was
-- handed, the way a Mac's upsert does. page_thumb stays null: a worker has no pane to capture.
create or replace function public.worker_put_card(p_key text, p_card_id text, p_folder text, p_card jsonb, p_deleted boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
  v_page text := nullif(p_card->>'page', '');
  v_pages int := case when jsonb_typeof(p_card->'pages') = 'number' then floor((p_card->>'pages')::numeric)::int else 0 end;
begin
  if exists (select 1 from public.cloud_cards c where c.org_id = w.org_id and c.card_id = p_card_id
             and c.owner_worker is distinct from w.id) then
    raise exception 'that card belongs to another device' using errcode = '42501';
  end if;
  insert into public.cloud_cards (org_id, card_id, owner_device, owner_user, owner_worker, folder, card, deleted, page, pages)
    values (w.org_id, p_card_id, 'worker:' || w.id::text, w.owner_user, w.id, p_folder, p_card, coalesce(p_deleted, false), v_page, v_pages)
  on conflict (org_id, card_id) do update
    set folder = excluded.folder, card = excluded.card, deleted = excluded.deleted, page = excluded.page, pages = excluded.pages, updated_at = now();
end;
$$;
