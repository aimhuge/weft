-- The team's Slack incoming webhook, for the deployed Weft's feedback path (lib/feedback-send.ts).
--
-- The webhook's URL is a credential: anyone holding it can post to the channel. Slack has no Web API method
-- for incoming webhooks — no create, no list, no delete — so the only programmatic route to the address is an
-- OAuth install, whose answer carries `incoming_webhook.url`. That answer arrives at
-- app/api/slack/oauth/callback, which exchanges the code and writes the URL here.
--
-- It lives in the database rather than a Vercel environment variable so the URL never has to be copied out of
-- a console page by hand and never appears in a deploy log, a transcript or a support screenshot. The service
-- role reads it; the collector posts to it. Nothing else may.
--
-- docs/architecture/feedback.md.

create table public.slack_webhooks (
  -- One row per purpose. 'feedback' is the only one today.
  purpose   text primary key check (char_length(purpose) between 1 and 40),
  -- The https://hooks.slack.com/services/… address. A credential: the service role only.
  url       text not null check (char_length(url) between 20 and 400),
  -- The channel it is bound to, so the team can tell where feedback lands without opening the URL.
  channel   text check (char_length(channel) <= 120),
  updated_at timestamptz not null default now()
);

-- No policies: only the service role (the OAuth callback) writes, and the collector reads. A row here is a
-- credential, so a public read would hand the channel's posting URL to anyone who asked.
alter table public.slack_webhooks enable row level security;
