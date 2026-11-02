-- Speeds up the DELETE ... WHERE slack_team_id = $1 AND issue_id = $2
create index if not exists linear_data_chunks_team_issue_idx
  on public.linear_data_chunks (slack_team_id, issue_id);

-- HNSW = an approximate nearest-neighbor index (fast "find similar vectors").
-- vector_cosine_ops must match the <=> operator the query uses.
create index if not exists linear_data_chunks_embedding_hnsw_idx
  on public.linear_data_chunks
  using hnsw (embedding extensions.vector_cosine_ops);