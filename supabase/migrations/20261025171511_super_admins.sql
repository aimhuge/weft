-- Super admins: accounts that see the Admin pages (lib/admin.ts). Replaces having to redeploy to change
-- SUPER_ADMIN_EMAILS; the env list still works and is the bootstrap. docs/architecture/admin.md.

create table public.super_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  -- Who this is, for the person reading the table; the gate matches on user_id.
  email      text not null,
  created_at timestamptz not null default now()
);

-- A signed-in account may read its own row (that is how the gate asks "am I one?"). No insert, update or
-- delete policies: only the service role or the dashboard adds and removes super admins.
alter table public.super_admins enable row level security;

create policy super_admins_read_own on public.super_admins
  for select to authenticated
  using (user_id = (select auth.uid()));

insert into public.super_admins (user_id, email)
select id, email from auth.users where email = 'fotoflo@gmail.com'
on conflict (user_id) do nothing;
