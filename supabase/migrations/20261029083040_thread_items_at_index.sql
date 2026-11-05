-- `public.infra_live()` (20261027094500_infra_live.sql) counts `cloud_thread_items` twice: all of them, and the
-- ones from the last day. With no index on `at`, both were a sequential scan of the whole wide table, which took
-- 6 s and more on this instance and tipped the call over PostgREST's 8 s statement timeout (57014), so the
-- repo-analysis report read a 500 for every database number.
--
-- An index on `at` answers the 24-hour count with a range scan, and gives the planner a narrow index to count
-- the whole table from instead of the heap.
create index if not exists cloud_thread_items_at on public.cloud_thread_items (at);
