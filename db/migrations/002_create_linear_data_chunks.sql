create table if not exists public.linear_data_chunks (
  id            bigint generated always as identity primary key,
  slack_team_id text not null,
  issue_id      text not null,
  identifier    text not null,
  issue_title   text not null,
  chunk_text    text not null,
  embedding     extensions.vector(1024) not null,
  created_at    timestamptz not null default now()
);

-- Row Level Security: Supabase exposes `public` tables over a web API that
-- anyone with your publishable key can call. RLS with no policies locks that
-- door. Your server connects as the `postgres` role directly, which bypasses RLS.
alter table public.linear_data_chunks enable row level security;
revoke all on table public.linear_data_chunks from anon, authenticated;