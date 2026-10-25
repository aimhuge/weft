-- Feedback: the summaries the board's feedback dot sends (lib/feedback-send.ts). Haiku interviews the user about
-- what's in their way, they check the summary, and the deployed Weft keeps it here and posts it to the team's Slack.
-- docs/architecture/feedback.md.

create table public.feedback (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(title) between 1 and 120),
  body       text not null check (char_length(body) between 1 and 4000),
  -- The interview, [{role, text}], at most 30 messages.
  messages   jsonb not null default '[]'::jsonb,
  -- Who sent it, when they were signed in, so the team can write back.
  from_name  text check (char_length(from_name) <= 120),
  from_email text check (char_length(from_email) <= 200),
  version    text check (char_length(version) <= 40),
  created_at timestamptz not null default now()
);

create index feedback_created on public.feedback (created_at desc);

-- No policies: only the service role (the collector) writes, and the team reads it in the dashboard.
alter table public.feedback enable row level security;
