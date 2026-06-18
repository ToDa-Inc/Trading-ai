import json
import os
import tempfile
from pathlib import Path

from supabase import create_client

from app.config import settings
from app.openrouter_client import (
    analyze_video,
    analyze_youtube_video,
    embed_text,
    merge_strategy_profile,
)


def get_supabase():
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def update_video_status(video_id: str, status: str, error: str | None = None):
    supabase = get_supabase()
    supabase.table("videos").update({"status": status, "error": error}).eq("id", video_id).execute()


def _resolve_youtube_url(video: dict) -> str | None:
    url = (video.get("youtube_url") or "").strip()
    if url:
        return url
    video_id = (video.get("youtube_video_id") or "").strip()
    if video_id:
        return f"https://www.youtube.com/watch?v={video_id}"
    return None


def _resolve_storage_path(video: dict) -> str | None:
    path = (video.get("storage_path") or "").strip()
    return path or None


def process_video(video_id: str, webhook_record: dict | None = None):
    """Full ingestion pipeline for a single video."""
    supabase = get_supabase()
    video: dict = {}
    youtube_url: str | None = None
    storage_path: str | None = None
    try:
        update_video_status(video_id, "processing")

        video_resp = supabase.table("videos").select("*").eq("id", video_id).single().execute()
        video = video_resp.data
        if not video:
            raise ValueError(f"Video {video_id} not found")

        # Webhook payload can include fields before PostgREST schema cache catches up
        if webhook_record:
            for key in ("youtube_url", "youtube_video_id", "storage_path", "filename"):
                if not video.get(key) and webhook_record.get(key):
                    video[key] = webhook_record[key]

        user_id = video["user_id"]
        youtube_url = _resolve_youtube_url(video)
        storage_path = _resolve_storage_path(video)

        print(f"[ingest] video_id={video_id} youtube_url={bool(youtube_url)} storage_path={storage_path!r}")

        # Clean up any data from previous (failed) runs to stay idempotent
        supabase.table("chunks").delete().eq("video_id", video_id).execute()
        supabase.table("video_analyses").delete().eq("video_id", video_id).execute()

        if youtube_url:
            analysis = analyze_youtube_video(youtube_url)
        elif storage_path:
            file_data = supabase.storage.from_("trading-videos").download(storage_path)

            suffix = Path(video["filename"]).suffix or ".mp4"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(file_data)
                tmp_path = tmp.name

            try:
                mime_map = {
                    ".mp4": "video/mp4",
                    ".webm": "video/webm",
                    ".mov": "video/mov",
                    ".avi": "video/mp4",
                    ".mpeg": "video/mpeg",
                }
                mime_type = mime_map.get(suffix.lower(), "video/mp4")

                analysis = analyze_video(tmp_path, mime_type)
            finally:
                os.unlink(tmp_path)
        else:
            raise ValueError(
                "Video has no youtube_url/youtube_video_id and no storage_path. "
                "If this is a YouTube video, run the youtube_urls migration and reload the schema."
            )

        supabase.table("video_analyses").insert({
            "video_id": video_id,
            "user_id": user_id,
            "transcript": analysis.get("transcript", ""),
            "structured_json": analysis,
        }).execute()

        segments = analysis.get("segments", [])
        if not segments:
            strategy = analysis.get("strategy", {})
            segments = [{
                "topic": "Estrategia completa",
                "ts_start": 0,
                "ts_end": None,
                "content": json.dumps(strategy, ensure_ascii=False),
                "rules": strategy.get("entry_rules", []) + strategy.get("exit_rules", []),
            }]

        chunk_metadata_base = {
            "filename": video["filename"],
        }
        if youtube_url:
            chunk_metadata_base["youtube_url"] = youtube_url
            if video.get("youtube_video_id"):
                chunk_metadata_base["youtube_video_id"] = video["youtube_video_id"]

        for segment in segments:
            content = segment.get("content", "")
            topic = segment.get("topic", "General")
            if topic and topic not in content:
                content = f"{topic}\n{content}"
            rules = segment.get("rules", [])
            if rules:
                content += "\nReglas: " + "; ".join(rules)

            embedding = embed_text(content)

            supabase.table("chunks").insert({
                "video_id": video_id,
                "user_id": user_id,
                "content": content,
                "metadata": {
                    **chunk_metadata_base,
                    "topic": segment.get("topic"),
                    "rules": rules,
                },
                "ts_start": segment.get("ts_start"),
                "ts_end": segment.get("ts_end"),
                "embedding": embedding,
            }).execute()

        profile_resp = supabase.table("strategy_profiles").select("summary_md").eq("user_id", user_id).maybe_single().execute()
        existing_summary = profile_resp.data["summary_md"] if profile_resp and profile_resp.data else ""
        new_summary = merge_strategy_profile(existing_summary, analysis)

        supabase.table("strategy_profiles").upsert({
            "user_id": user_id,
            "summary_md": new_summary,
        }).execute()

        update_video_status(video_id, "processed")

    except Exception as e:
        error_msg = str(e)
        if "Object not found" in error_msg and youtube_url:
            error_msg = (
                "Storage download failed but this is a YouTube video — "
                "restart the worker so it uses the YouTube analysis path."
            )
        elif "Object not found" in error_msg and storage_path:
            error_msg = (
                f"Video file not found in storage at '{storage_path}'. "
                "Re-upload the file or delete this entry."
            )
        update_video_status(video_id, "error", error=error_msg)
        raise


def poll_pending_videos():
    """Fallback: process any pending videos."""
    supabase = get_supabase()
    resp = supabase.table("videos").select("id").eq("status", "pending").limit(5).execute()
    for row in resp.data or []:
        try:
            process_video(row["id"])
        except Exception:
            pass
