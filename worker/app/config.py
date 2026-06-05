from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    supabase_url: str
    supabase_service_role_key: str
    gemini_api_key: str
    worker_secret: str
    gemini_video_model: str = "gemini-2.5-flash"
    gemini_chat_model: str = "gemini-2.5-flash"
    gemini_embedding_model: str = "text-embedding-004"
    port: int = 8000

    class Config:
        env_file = ".env"


settings = Settings()
