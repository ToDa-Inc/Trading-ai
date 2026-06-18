import asyncio
from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.ingest import poll_pending_videos, process_video


@asynccontextmanager
async def lifespan(app: FastAPI):
    async def poll_loop():
        while True:
            try:
                poll_pending_videos()
            except Exception:
                pass
            await asyncio.sleep(60)

    task = asyncio.create_task(poll_loop())
    yield
    task.cancel()


app = FastAPI(title="Trading RAG Worker", lifespan=lifespan)


class WebhookPayload(BaseModel):
    type: str
    table: str
    record: dict
    old_record: dict | None = None


def verify_secret(x_worker_secret: str | None):
    if x_worker_secret != settings.worker_secret:
        raise HTTPException(status_code=401, detail="Invalid worker secret")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "worker"}


@app.get("/ready")
async def ready():
    required_settings = {
        "supabase_url": settings.supabase_url,
        "supabase_service_role_key": settings.supabase_service_role_key,
        "openrouter_api_key": settings.openrouter_api_key,
        "worker_secret": settings.worker_secret,
    }
    missing = [key for key, value in required_settings.items() if not value]

    if missing:
        raise HTTPException(status_code=503, detail={"missing": missing})

    return {"status": "ready", "service": "worker"}


@app.post("/ingest")
async def ingest_webhook(
    payload: WebhookPayload,
    background_tasks: BackgroundTasks,
    x_worker_secret: str | None = Header(None),
):
    verify_secret(x_worker_secret)

    if payload.table != "videos" or payload.type != "INSERT":
        return {"status": "ignored"}

    video_id = payload.record.get("id")
    if not video_id:
        raise HTTPException(status_code=400, detail="Missing video id")

    background_tasks.add_task(process_video, video_id, payload.record)
    return {"status": "queued", "video_id": video_id}


@app.post("/ingest/{video_id}")
async def ingest_manual(
    video_id: str,
    background_tasks: BackgroundTasks,
    x_worker_secret: str | None = Header(None),
):
    verify_secret(x_worker_secret)
    background_tasks.add_task(process_video, video_id)
    return {"status": "queued", "video_id": video_id}
