from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    openrouter_api_key: str = ""
    worker_secret: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_site_url: str = "http://localhost:8000"
    openrouter_app_name: str = "Trading Coach Worker"
    # Multimodal: video analysis + chat + image screenshots
    openrouter_video_model: str = "google/gemini-3-flash-preview"
    openrouter_chat_model: str = "google/gemini-3.1-flash-lite"
    # RAG: separate embedding model (768-dim vectors in pgvector)
    openrouter_embedding_model: str = "openai/text-embedding-3-small"
    openrouter_embedding_dimensions: int = 768
    port: int = 8000

    class Config:
        env_file = ".env"


settings = Settings()
