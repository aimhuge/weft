-- Each synced card's GitHub repo (owner/name), so a teammate's desktop board can file it under its own checkout of the
-- same repo (lib/team-board.ts): `folder` is a path on the owner's Mac and differs per teammate. Null for a folder with
-- no GitHub remote and for every row written before this column. Additive only: no backfill.
alter table public.cloud_cards add column if not exists repo text;

-- The team board's read, verbatim: one org's cards for the repos this Mac has checked out.
create index if not exists cloud_cards_org_repo_idx on public.cloud_cards (org_id, repo) where repo is not null;
