import { NextRequest, NextResponse } from "next/server";
import { normalizeYoutubeUrl } from "@/lib/youtube";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  const normalized = normalizeYoutubeUrl(url);
  if (!normalized) {
    return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(normalized)}&format=json`,
      { next: { revalidate: 3600 } }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: "Video not found or not embeddable" },
        { status: res.status === 404 ? 404 : 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json({
      title: data.title as string,
      thumbnail_url: data.thumbnail_url as string,
      author_name: data.author_name as string | undefined,
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch video metadata" }, { status: 502 });
  }
}
