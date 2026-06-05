-- Storage buckets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('trading-videos', 'trading-videos', false, 2147483648, array['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/mpeg']),
  ('chat-uploads', 'chat-uploads', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- Trading videos storage policies
create policy "Users can upload own videos"
  on storage.objects for insert
  with check (
    bucket_id = 'trading-videos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can view own videos"
  on storage.objects for select
  using (
    bucket_id = 'trading-videos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can delete own videos"
  on storage.objects for delete
  using (
    bucket_id = 'trading-videos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Chat uploads storage policies
create policy "Users can upload own chat images"
  on storage.objects for insert
  with check (
    bucket_id = 'chat-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can view own chat images"
  on storage.objects for select
  using (
    bucket_id = 'chat-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
