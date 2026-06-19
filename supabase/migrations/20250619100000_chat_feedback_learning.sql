-- Feedback and learning memory for chat agent improvement

create table public.chat_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  rating text not null check (rating in ('positive', 'negative', 'correction')),
  feedback_type text not null check (
    feedback_type in ('correct', 'wrong', 'missed_rule', 'too_generic', 'correction')
  ),
  comment text,
  created_at timestamptz not null default now()
);

create table public.agent_memory_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.chat_sessions(id) on delete cascade,
  source_feedback_id uuid references public.chat_feedback(id) on delete set null,
  candidate_text text not null,
  scope text not null check (scope in ('session', 'global_strategy')),
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'dismissed')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agent_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_candidate_id uuid references public.agent_memory_candidates(id) on delete set null,
  memory_text text not null,
  scope text not null default 'global_strategy' check (scope in ('global_strategy')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chat_feedback_user_id_idx on public.chat_feedback(user_id);
create index chat_feedback_message_id_idx on public.chat_feedback(message_id);
create index agent_memory_candidates_user_id_idx on public.agent_memory_candidates(user_id);
create index agent_memory_candidates_status_idx on public.agent_memory_candidates(status);
create index agent_memories_user_id_idx on public.agent_memories(user_id);

create trigger agent_memory_candidates_updated_at
  before update on public.agent_memory_candidates
  for each row execute function public.handle_updated_at();

create trigger agent_memories_updated_at
  before update on public.agent_memories
  for each row execute function public.handle_updated_at();

alter table public.chat_feedback enable row level security;
alter table public.agent_memory_candidates enable row level security;
alter table public.agent_memories enable row level security;

create policy "Users can view own feedback" on public.chat_feedback
  for select using (auth.uid() = user_id);
create policy "Users can insert own feedback" on public.chat_feedback
  for insert with check (auth.uid() = user_id);

create policy "Users can view own memory candidates" on public.agent_memory_candidates
  for select using (auth.uid() = user_id);
create policy "Users can insert own memory candidates" on public.agent_memory_candidates
  for insert with check (auth.uid() = user_id);
create policy "Users can update own memory candidates" on public.agent_memory_candidates
  for update using (auth.uid() = user_id);

create policy "Users can view own memories" on public.agent_memories
  for select using (auth.uid() = user_id);
create policy "Users can insert own memories" on public.agent_memories
  for insert with check (auth.uid() = user_id);
create policy "Users can update own memories" on public.agent_memories
  for update using (auth.uid() = user_id);
create policy "Users can delete own memories" on public.agent_memories
  for delete using (auth.uid() = user_id);
