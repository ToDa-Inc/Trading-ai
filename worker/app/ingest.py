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


def _as_list(value) -> list:
    return value if isinstance(value, list) else []


def _format_rule(rule: dict) -> str:
    parts = [
        f"Tipo: {rule.get('type', 'rule')}",
        f"Regla: {rule.get('rule', '')}",
    ]
    conditions = _as_list(rule.get("conditions"))
    visual_cues = _as_list(rule.get("visual_cues"))
    if conditions:
        parts.append("Condiciones: " + "; ".join(str(c) for c in conditions))
    if visual_cues:
        parts.append("Señales visuales: " + "; ".join(str(c) for c in visual_cues))
    if rule.get("priority"):
        parts.append(f"Prioridad: {rule['priority']}")
    return "\n".join(part for part in parts if part.strip())


def _format_example(example: dict, *, valid: bool) -> str:
    label = "Ejemplo válido" if valid else "Ejemplo inválido / evitar"
    parts = [
        label,
        f"Setup: {example.get('setup', '')}",
        f"Contexto: {example.get('context', '')}",
        f"Decisión: {example.get('decision', '')}",
    ]
    reasons = _as_list(example.get("reasons"))
    if reasons:
        parts.append("Razones: " + "; ".join(str(r) for r in reasons))
    return "\n".join(part for part in parts if part.strip())


def _build_knowledge_chunks(analysis: dict) -> list[dict]:
    chunks: list[dict] = []

    for rule in _as_list(analysis.get("atomic_rules")):
        if isinstance(rule, dict) and rule.get("rule"):
            chunks.append({
                "content": _format_rule(rule),
                "metadata": {
                    "knowledge_type": "atomic_rule",
                    "rule_type": rule.get("type"),
                    "priority": rule.get("priority"),
                    "conditions": _as_list(rule.get("conditions")),
                    "visual_cues": _as_list(rule.get("visual_cues")),
                },
            })

    for observation in _as_list(analysis.get("visual_observations")):
        if observation:
            chunks.append({
                "content": f"Observación visual de estrategia:\n{observation}",
                "metadata": {"knowledge_type": "visual_observation"},
            })

    for decision in _as_list(analysis.get("decision_points")):
        if decision:
            chunks.append({
                "content": f"Lógica de decisión:\n{decision}",
                "metadata": {"knowledge_type": "decision_point"},
            })

    for example in _as_list(analysis.get("valid_examples")):
        if isinstance(example, dict):
            chunks.append({
                "content": _format_example(example, valid=True),
                "metadata": {
                    "knowledge_type": "valid_example",
                    "setup": example.get("setup"),
                },
            })

    for example in _as_list(analysis.get("invalid_examples")):
        if isinstance(example, dict):
            chunks.append({
                "content": _format_example(example, valid=False),
                "metadata": {
                    "knowledge_type": "invalid_example",
                    "setup": example.get("setup"),
                },
            })

    for segment in _as_list(analysis.get("segments")):
        if not isinstance(segment, dict):
            continue
        topic = segment.get("topic", "General")
        content = segment.get("content", "")
        if topic and topic not in content:
            content = f"{topic}\n{content}"
        rules = _as_list(segment.get("rules"))
        if rules:
            content += "\nReglas: " + "; ".join(str(rule) for rule in rules)
        if content.strip():
            chunks.append({
                "content": content,
                "metadata": {
                    "knowledge_type": "segment",
                    "topic": topic,
                    "rules": rules,
                },
                "ts_start": segment.get("ts_start"),
                "ts_end": segment.get("ts_end"),
            })

    if not chunks:
        chunks.append({
            "content": json.dumps(analysis.get("strategy", {}), ensure_ascii=False),
            "metadata": {"knowledge_type": "strategy"},
        })

    return chunks


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

        chunk_metadata_base = {
            "filename": video["filename"],
        }
        if youtube_url:
            chunk_metadata_base["youtube_url"] = youtube_url
            if video.get("youtube_video_id"):
                chunk_metadata_base["youtube_video_id"] = video["youtube_video_id"]

        for chunk in _build_knowledge_chunks(analysis):
            embedding = embed_text(chunk["content"])

            supabase.table("chunks").insert({
                "video_id": video_id,
                "user_id": user_id,
                "content": chunk["content"],
                "metadata": {
                    **chunk_metadata_base,
                    **chunk.get("metadata", {}),
                },
                "ts_start": chunk.get("ts_start"),
                "ts_end": chunk.get("ts_end"),
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
