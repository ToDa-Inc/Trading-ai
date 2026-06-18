-- =============================================================
-- Trading Coach - Setup completo de Supabase (un solo paso)
-- Pega TODO este archivo en el SQL Editor del proyecto NUEVO y ejecuta.
-- Es idempotente: se puede ejecutar varias veces sin romper nada.
-- =============================================================

-- ---------- Extensiones ----------
create extension if not exists vector with schema extensions;

-- ---------- Tablas ----------
create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text,
  filename text not null,
  duration_seconds numeric,
  status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'error')),
  error text,
  gemini_file_uri text,
  youtube_url text,
  youtube_video_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint videos_source_check check (storage_path is not null or youtube_url is not null)
);

create table if not exists public.video_analyses (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  transcript text,
  structured_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.chunks (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  metadata jsonb not null default '{}',
  ts_start numeric,
  ts_end numeric,
  embedding extensions.vector(1536),
  created_at timestamptz not null default now()
);

create table if not exists public.strategy_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  summary_md text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nueva conversación',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  image_path text,
  citations jsonb default '[]',
  created_at timestamptz not null default now()
);

-- ---------- Índices ----------
create index if not exists videos_user_id_idx on public.videos(user_id);
create index if not exists videos_status_idx on public.videos(status);
create index if not exists chunks_user_id_idx on public.chunks(user_id);
create index if not exists chunks_video_id_idx on public.chunks(video_id);
create index if not exists chat_sessions_user_id_idx on public.chat_sessions(user_id);
create index if not exists chat_messages_session_id_idx on public.chat_messages(session_id);

create index if not exists chunks_embedding_hnsw_idx on public.chunks
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ---------- Trigger updated_at ----------
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists videos_updated_at on public.videos;
create trigger videos_updated_at
  before update on public.videos
  for each row execute function public.handle_updated_at();

drop trigger if exists chat_sessions_updated_at on public.chat_sessions;
create trigger chat_sessions_updated_at
  before update on public.chat_sessions
  for each row execute function public.handle_updated_at();

drop trigger if exists strategy_profiles_updated_at on public.strategy_profiles;
create trigger strategy_profiles_updated_at
  before update on public.strategy_profiles
  for each row execute function public.handle_updated_at();

-- ---------- RLS ----------
alter table public.videos enable row level security;
alter table public.video_analyses enable row level security;
alter table public.chunks enable row level security;
alter table public.strategy_profiles enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

-- Videos
drop policy if exists "Users can view own videos" on public.videos;
create policy "Users can view own videos" on public.videos
  for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own videos" on public.videos;
create policy "Users can insert own videos" on public.videos
  for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own videos" on public.videos;
create policy "Users can update own videos" on public.videos
  for update using (auth.uid() = user_id);
drop policy if exists "Users can delete own videos" on public.videos;
create policy "Users can delete own videos" on public.videos
  for delete using (auth.uid() = user_id);

-- Video analyses
drop policy if exists "Users can view own analyses" on public.video_analyses;
create policy "Users can view own analyses" on public.video_analyses
  for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own analyses" on public.video_analyses;
create policy "Users can insert own analyses" on public.video_analyses
  for insert with check (auth.uid() = user_id);

-- Chunks
drop policy if exists "Users can view own chunks" on public.chunks;
create policy "Users can view own chunks" on public.chunks
  for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own chunks" on public.chunks;
create policy "Users can insert own chunks" on public.chunks
  for insert with check (auth.uid() = user_id);
drop policy if exists "Users can delete own chunks" on public.chunks;
create policy "Users can delete own chunks" on public.chunks
  for delete using (auth.uid() = user_id);

-- Strategy profiles
drop policy if exists "Users can view own strategy profile" on public.strategy_profiles;
create policy "Users can view own strategy profile" on public.strategy_profiles
  for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own strategy profile" on public.strategy_profiles;
create policy "Users can insert own strategy profile" on public.strategy_profiles
  for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own strategy profile" on public.strategy_profiles;
create policy "Users can update own strategy profile" on public.strategy_profiles
  for update using (auth.uid() = user_id);

-- Chat sessions
drop policy if exists "Users can view own sessions" on public.chat_sessions;
create policy "Users can view own sessions" on public.chat_sessions
  for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own sessions" on public.chat_sessions;
create policy "Users can insert own sessions" on public.chat_sessions
  for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own sessions" on public.chat_sessions;
create policy "Users can update own sessions" on public.chat_sessions
  for update using (auth.uid() = user_id);
drop policy if exists "Users can delete own sessions" on public.chat_sessions;
create policy "Users can delete own sessions" on public.chat_sessions
  for delete using (auth.uid() = user_id);

-- Chat messages
drop policy if exists "Users can view own messages" on public.chat_messages;
create policy "Users can view own messages" on public.chat_messages
  for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own messages" on public.chat_messages;
create policy "Users can insert own messages" on public.chat_messages
  for insert with check (auth.uid() = user_id);

-- ---------- RPC: match_chunks (RAG retrieval) ----------
create or replace function public.match_chunks(
  query_embedding extensions.vector(1536),
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

-- ---------- Storage buckets ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('trading-videos', 'trading-videos', false, 2147483648, array['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/mpeg']),
  ('chat-uploads', 'chat-uploads', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- ---------- Storage policies ----------
drop policy if exists "Users can upload own videos" on storage.objects;
create policy "Users can upload own videos"
  on storage.objects for insert
  with check (
    bucket_id = 'trading-videos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can view own videos" on storage.objects;
create policy "Users can view own videos"
  on storage.objects for select
  using (
    bucket_id = 'trading-videos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can delete own videos" on storage.objects;
create policy "Users can delete own videos"
  on storage.objects for delete
  using (
    bucket_id = 'trading-videos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can upload own chat images" on storage.objects;
create policy "Users can upload own chat images"
  on storage.objects for insert
  with check (
    bucket_id = 'chat-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can view own chat images" on storage.objects;
create policy "Users can view own chat images"
  on storage.objects for select
  using (
    bucket_id = 'chat-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ---------- Realtime (tabla videos) ----------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'videos'
  ) then
    alter publication supabase_realtime add table public.videos;
  end if;
end $$;

-- =============================================================
-- Listo. Verifica con:  cd web && node scripts/test-supabase.mjs
-- =============================================================
