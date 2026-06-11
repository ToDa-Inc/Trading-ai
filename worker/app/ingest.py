import json
import os
import tempfile
from pathlib import Path

from supabase import create_client

from app.config import settings
from app.gemini_client import (
    analyze_video,
    embed_text,
    merge_strategy_profile,
    upload_video_to_gemini,
)

supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)


def update_video_status(video_id: str, status: str, error: str | None = None, gemini_file_uri: str | None = None):
    data = {"status": status, "error": error}
    if gemini_file_uri:
        data["gemini_file_uri"] = gemini_file_uri
    supabase.table("videos").update(data).eq("id", video_id).execute()


def process_video(video_id: str):
    """Full ingestion pipeline for a single video."""
    try:
        update_video_status(video_id, "processing")

        video_resp = supabase.table("videos").select("*").eq("id", video_id).single().execute()
        video = video_resp.data
        if not video:
            raise ValueError(f"Video {video_id} not found")

        user_id = video["user_id"]
        storage_path = video["storage_path"]

        # Clean up any data from previous (failed) runs to stay idempotent
        supabase.table("chunks").delete().eq("video_id", video_id).execute()
        supabase.table("video_analyses").delete().eq("video_id", video_id).execute()

        # Download from Supabase Storage
        file_data = supabase.storage.from_("trading-videos").download(storage_path)

        suffix = Path(video["filename"]).suffix or ".mp4"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(file_data)
            tmp_path = tmp.name

        try:
            mime_map = {
                ".mp4": "video/mp4",
                ".webm": "video/webm",
                ".mov": "video/quicktime",
                ".avi": "video/x-msvideo",
                ".mpeg": "video/mpeg",
            }
            mime_type = mime_map.get(suffix.lower(), "video/mp4")

            gemini_file = upload_video_to_gemini(tmp_path, mime_type)
            analysis = analyze_video(gemini_file)

            # Store analysis
            supabase.table("video_analyses").insert({
                "video_id": video_id,
                "user_id": user_id,
                "transcript": analysis.get("transcript", ""),
                "structured_json": analysis,
            }).execute()

            # Create chunks from segments
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

            for segment in segments:
                content = f"Tema: {segment.get('topic', 'General')}\n{segment.get('content', '')}"
                rules = segment.get("rules", [])
                if rules:
                    content += "\nReglas: " + "; ".join(rules)

                embedding = embed_text(content)

                supabase.table("chunks").insert({
                    "video_id": video_id,
                    "user_id": user_id,
                    "content": content,
                    "metadata": {
                        "topic": segment.get("topic"),
                        "filename": video["filename"],
                        "rules": rules,
                    },
                    "ts_start": segment.get("ts_start"),
                    "ts_end": segment.get("ts_end"),
                    "embedding": embedding,
                }).execute()

            # Update strategy profile
            profile_resp = supabase.table("strategy_profiles").select("summary_md").eq("user_id", user_id).maybe_single().execute()
            existing_summary = profile_resp.data["summary_md"] if profile_resp and profile_resp.data else ""
            new_summary = merge_strategy_profile(existing_summary, analysis)

            supabase.table("strategy_profiles").upsert({
                "user_id": user_id,
                "summary_md": new_summary,
            }).execute()

            update_video_status(video_id, "processed", gemini_file_uri=gemini_file.uri)

        finally:
            os.unlink(tmp_path)

    except Exception as e:
        update_video_status(video_id, "error", error=str(e))
        raise


def poll_pending_videos():
    """Fallback: process any pending videos."""
    resp = supabase.table("videos").select("id").eq("status", "pending").limit(5).execute()
    for row in resp.data or []:
        try:
            process_video(row["id"])
        except Exception:
            pass
