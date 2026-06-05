-- Enable pgvector
create extension if not exists vector with schema extensions;

-- Videos table
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  filename text not null,
  duration_seconds numeric,
  status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'error')),
  error text,
  gemini_file_uri text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Video analyses
create table public.video_analyses (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  transcript text,
  structured_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Chunks for RAG
create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  metadata jsonb not null default '{}',
  ts_start numeric,
  ts_end numeric,
  embedding extensions.vector(768),
  created_at timestamptz not null default now()
);

-- Strategy profile (always injected in chat context)
create table public.strategy_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  summary_md text not null default '',
  updated_at timestamptz not null default now()
);

-- Chat sessions
create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nueva conversación',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Chat messages
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  image_path text,
  citations jsonb default '[]',
  created_at timestamptz not null default now()
);

-- Indexes
create index videos_user_id_idx on public.videos(user_id);
create index videos_status_idx on public.videos(status);
create index chunks_user_id_idx on public.chunks(user_id);
create index chunks_video_id_idx on public.chunks(video_id);
create index chat_sessions_user_id_idx on public.chat_sessions(user_id);
create index chat_messages_session_id_idx on public.chat_messages(session_id);

-- HNSW index for vector search
create index chunks_embedding_hnsw_idx on public.chunks
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Updated_at trigger
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger videos_updated_at
  before update on public.videos
  for each row execute function public.handle_updated_at();

create trigger chat_sessions_updated_at
  before update on public.chat_sessions
  for each row execute function public.handle_updated_at();

create trigger strategy_profiles_updated_at
  before update on public.strategy_profiles
  for each row execute function public.handle_updated_at();

-- RLS
alter table public.videos enable row level security;
alter table public.video_analyses enable row level security;
alter table public.chunks enable row level security;
alter table public.strategy_profiles enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

-- Videos policies
create policy "Users can view own videos" on public.videos
  for select using (auth.uid() = user_id);
create policy "Users can insert own videos" on public.videos
  for insert with check (auth.uid() = user_id);
create policy "Users can update own videos" on public.videos
  for update using (auth.uid() = user_id);
create policy "Users can delete own videos" on public.videos
  for delete using (auth.uid() = user_id);

-- Video analyses policies
create policy "Users can view own analyses" on public.video_analyses
  for select using (auth.uid() = user_id);
create policy "Users can insert own analyses" on public.video_analyses
  for insert with check (auth.uid() = user_id);

-- Chunks policies
create policy "Users can view own chunks" on public.chunks
  for select using (auth.uid() = user_id);
create policy "Users can insert own chunks" on public.chunks
  for insert with check (auth.uid() = user_id);
create policy "Users can delete own chunks" on public.chunks
  for delete using (auth.uid() = user_id);

-- Strategy profiles policies
create policy "Users can view own strategy profile" on public.strategy_profiles
  for select using (auth.uid() = user_id);
create policy "Users can insert own strategy profile" on public.strategy_profiles
  for insert with check (auth.uid() = user_id);
create policy "Users can update own strategy profile" on public.strategy_profiles
  for update using (auth.uid() = user_id);

-- Chat sessions policies
create policy "Users can view own sessions" on public.chat_sessions
  for select using (auth.uid() = user_id);
create policy "Users can insert own sessions" on public.chat_sessions
  for insert with check (auth.uid() = user_id);
create policy "Users can update own sessions" on public.chat_sessions
  for update using (auth.uid() = user_id);
create policy "Users can delete own sessions" on public.chat_sessions
  for delete using (auth.uid() = user_id);

-- Chat messages policies
create policy "Users can view own messages" on public.chat_messages
  for select using (auth.uid() = user_id);
create policy "Users can insert own messages" on public.chat_messages
  for insert with check (auth.uid() = user_id);

-- Service role bypass for worker (uses service role key)
-- Worker uses service role which bypasses RLS

-- RPC: match_chunks for RAG retrieval
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

-- Storage buckets (run via Supabase dashboard or API)
-- trading-videos: private, user-scoped paths
-- chat-uploads: private, user-scoped paths

-- Storage policies (apply after creating buckets in dashboard)
-- insert into storage.buckets (id, name, public) values ('trading-videos', 'trading-videos', false);
-- insert into storage.buckets (id, name, public) values ('chat-uploads', 'chat-uploads', false);
