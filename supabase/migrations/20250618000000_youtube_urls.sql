-- YouTube URL support: videos can be file uploads OR YouTube links
alter table public.videos alter column storage_path drop not null;

alter table public.videos
  add column if not exists youtube_url text,
  add column if not exists youtube_video_id text;

alter table public.videos drop constraint if exists videos_source_check;

alter table public.videos
  add constraint videos_source_check check (
    storage_path is not null or youtube_url is not null
  );

create index if not exists videos_youtube_video_id_idx on public.videos(youtube_video_id);
