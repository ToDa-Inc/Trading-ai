-- Align pgvector column and RPC with runtime OPENROUTER_EMBEDDING_DIMENSIONS=768
-- Safe to run: reindexes empty or existing 768-dim vectors

drop index if exists public.chunks_embedding_hnsw_idx;

alter table public.chunks drop column if exists embedding;
alter table public.chunks add column embedding extensions.vector(768);

create index chunks_embedding_hnsw_idx on public.chunks
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

drop function if exists public.match_chunks(extensions.vector, int, uuid);

create or replace function public.match_chunks(
  query_embedding extensions.vector(768),
  match_count int default 20,
  filter_user_id uuid default null
)
returns table (
  id uuid,
  video_id uuid,
  content text,
  metadata jsonb,
  ts_start numeric,
  ts_end numeric,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    c.id,
    c.video_id,
    c.content,
    c.metadata,
    c.ts_start,
    c.ts_end,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  where c.user_id = filter_user_id
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;
