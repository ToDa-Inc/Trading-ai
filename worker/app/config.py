from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    supabase_url: str
    supabase_service_role_key: str
    worker_secret: str
    # Google Gemini (directo) — solo para análisis de video
    gemini_api_key: str
    gemini_video_model: str = "gemini-2.5-flash"
    gemini_chat_model: str = "gemini-2.5-flash"
    # OpenRouter — embeddings (RAG)
    openrouter_api_key: str
    openrouter_embedding_model: str = "openai/text-embedding-3-small"
    port: int = 8000

    class Config:
        env_file = ".env"


settings = Settings()
