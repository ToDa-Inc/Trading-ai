import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  forwardToWorker,
  processYoutubeVideo,
  resolveYoutubeUrl,
} from "@/lib/video-ingest";

export const maxDuration = 300;

function verifySecret(request: NextRequest): boolean {
  const secret = request.headers.get("x-worker-secret");
  return Boolean(secret && secret === process.env.WORKER_SECRET);
}

/** Supabase Database Webhook — point INSERT on videos here instead of Railway for YouTube support */
export async function POST(request: NextRequest) {
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  if (payload.table !== "videos" || payload.type !== "INSERT") {
    return NextResponse.json({ status: "ignored" });
  }

  const record = payload.record as Record<string, unknown>;
  const videoId = record.id as string | undefined;
  if (!videoId) {
    return NextResponse.json({ error: "Missing video id" }, { status: 400 });
  }

  const youtubeUrl = resolveYoutubeUrl({
    youtube_url: record.youtube_url as string | null,
    youtube_video_id: record.youtube_video_id as string | null,
  });

  if (youtubeUrl) {
    const supabase = await createServiceClient();
    after(async () => {
      try {
        await processYoutubeVideo(supabase, videoId, record as never);
      } catch (err) {
        console.error(`[ingest] youtube failed video_id=${videoId}`, err);
        await supabase
          .from("videos")
          .update({
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          })
          .eq("id", videoId);
      }
    });
    return NextResponse.json({ status: "queued", processor: "vercel", video_id: videoId });
  }

  try {
    await forwardToWorker(videoId);
    return NextResponse.json({ status: "queued", processor: "railway", video_id: videoId });
  } catch (err) {
    console.error(`[ingest] worker forward failed video_id=${videoId}`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
