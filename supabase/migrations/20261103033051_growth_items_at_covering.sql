-- The growth reads (private.growth_activity, private.growth_engagement_activity, growth_active_by_day) scan
-- cloud_thread_items by time and only need (at, org_id, card_id, kind). The plain index on (at) made each
-- matching row fetch its wide heap page (payloads, 176 MB), which ran growth_active_by_day to ~17 s and past
-- the API's statement timeout: the Growth dashboard's active and retention panels showed
-- "canceling statement due to statement timeout". This covering index lets those scans run index-only.
create index if not exists cloud_thread_items_at_cover
  on public.cloud_thread_items using btree (at) include (org_id, card_id, kind);

drop index if exists public.cloud_thread_items_at;
