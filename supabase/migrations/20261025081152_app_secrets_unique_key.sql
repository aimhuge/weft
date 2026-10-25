-- cloud_app_secrets' unique key was an expression index on coalesce(viewer_id, …), which
-- ON CONFLICT (share_id, name, viewer_id) can't infer: every upsert failed. A plain unique
-- constraint with NULLS NOT DISTINCT keeps one author row (viewer_id null) per name and is
-- usable by ON CONFLICT.
drop index if exists public.cloud_app_secrets_key;
alter table public.cloud_app_secrets
  add constraint cloud_app_secrets_key unique nulls not distinct (share_id, name, viewer_id);
