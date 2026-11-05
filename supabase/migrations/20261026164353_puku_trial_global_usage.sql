-- The Puku trial's global daily meter (docs/architecture/puku-trial.md). Weft accounts are free, so one person can
-- open several for more trial; puku_trial_usage caps each account, and this caps the whole trial per UTC day across
-- every account, so Weft's own Puku key has a ceiling no number of accounts gets past. Only the free path counts:
-- a Pro workspace spends its own allowance.

create table public.puku_trial_global_usage (
  day date primary key,
  requests integer not null default 0,
  input_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Nobody reads or writes it but the proxy, whose secret key skips row-level security.
alter table public.puku_trial_global_usage enable row level security;
revoke all on public.puku_trial_global_usage from anon, authenticated;

-- Adds to the day's row and returns the totals after it, in one statement, so two requests at once can't both read
-- a total under the cap (as puku_trial_add does per account).
create function public.puku_trial_global_add(
  p_day date,
  p_requests integer,
  p_input bigint,
  p_cache_read bigint,
  p_output bigint
) returns public.puku_trial_global_usage
language sql
security invoker
set search_path = ''
as $$
  insert into public.puku_trial_global_usage as g (day, requests, input_tokens, cache_read_tokens, output_tokens)
  values (p_day, p_requests, p_input, p_cache_read, p_output)
  on conflict (day) do update set
    requests = g.requests + excluded.requests,
    input_tokens = g.input_tokens + excluded.input_tokens,
    cache_read_tokens = g.cache_read_tokens + excluded.cache_read_tokens,
    output_tokens = g.output_tokens + excluded.output_tokens,
    updated_at = now()
  returning g.*;
$$;

revoke execute on function public.puku_trial_global_add(date, integer, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.puku_trial_global_add(date, integer, bigint, bigint, bigint) to service_role;
