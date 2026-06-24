import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { forwardToWorker, processYoutubeVideo, resolveYoutubeUrl } from "@/lib/video-ingest";

export const maxDuration = 300;

/** Trigger YouTube video processing from the app (no Railway webhook needed) */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: videoId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const service = await createServiceClient();
  const { data: video, error } = await service
    .from("videos")
    .select("*")
    .eq("id", videoId)
    .eq("user_id", user.id)
    .single();

  if (error || !video) {
    return NextResponse.json({ error: "Video no encontrado" }, { status: 404 });
  }

  const youtubeUrl = resolveYoutubeUrl(video);
  if (video.status === "processing") {
    return NextResponse.json({ status: "already_processing" });
  }

  if (!youtubeUrl) {
    if (!video.storage_path) {
      return NextResponse.json(
        { error: "El video no tiene URL de YouTube ni archivo asociado." },
        { status: 400 }
      );
    }

    try {
      await forwardToWorker(videoId);
      return NextResponse.json({ status: "queued", processor: "worker", video_id: videoId });
    } catch (err) {
      await service
        .from("videos")
        .update({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        })
        .eq("id", videoId);

      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 502 }
      );
    }
  }

  after(async () => {
    try {
      await processYoutubeVideo(service, videoId, video);
    } catch (err) {
      console.error(`[ingest] process route failed video_id=${videoId}`, err);
      await service
        .from("videos")
        .update({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        })
        .eq("id", videoId);
    }
  });

  await service
    .from("videos")
    .update({ status: "processing", error: null })
    .eq("id", videoId);

  return NextResponse.json({ status: "queued", video_id: videoId });
}
