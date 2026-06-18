const YOUTUBE_ID_RE =
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

export function extractYoutubeVideoId(url: string): string | null {
  const trimmed = url.trim();
  const match = trimmed.match(YOUTUBE_ID_RE);
  return match?.[1] ?? null;
}

export function normalizeYoutubeUrl(url: string): string | null {
  const videoId = extractYoutubeVideoId(url);
  if (!videoId) return null;
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function youtubeThumbnailUrl(videoId: string, quality: "default" | "hq" | "mq" = "mq"): string {
  const map = { default: "default", hq: "hqdefault", mq: "mqdefault" };
  return `https://img.youtube.com/vi/${videoId}/${map[quality]}.jpg`;
}

export interface YoutubeOEmbed {
  title: string;
  thumbnail_url: string;
  author_name?: string;
}

export async function fetchYoutubeMetadata(url: string): Promise<YoutubeOEmbed | null> {
  const normalized = normalizeYoutubeUrl(url);
  if (!normalized) return null;

  try {
    const res = await fetch(
      `/api/youtube/oembed?url=${encodeURIComponent(normalized)}`
    );
    if (!res.ok) return null;
    return (await res.json()) as YoutubeOEmbed;
  } catch {
    return null;
  }
}

export function parseYoutubeUrls(text: string): string[] {
  const parts = text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const part of parts) {
    const normalized = normalizeYoutubeUrl(part);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      urls.push(normalized);
    }
  }

  return urls;
}
