"""Application settings, loaded from environment variables and ``backend/.env``."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ---- LLM (any OpenAI-compatible provider) ----
    llm_provider: str = "groq"  # groq | openai | openai_compatible | mock
    groq_api_key: str | None = None
    llm_api_key: str | None = None  # optional; overrides GROQ_API_KEY for other providers
    llm_base_url: str = "https://api.groq.com/openai/v1"
    llm_model: str = "llama-3.3-70b-versatile"
    llm_timeout_seconds: float = 30.0
    llm_max_retries: int = 5
    llm_backoff_base_seconds: float = 1.0
    llm_backoff_max_seconds: float = 30.0
    llm_max_concurrency: int = 4

    # ---- App ----
    database_url: str = f"sqlite:///{BACKEND_DIR / 'gd_arena.db'}"
    cors_origins: str = "*"
    log_level: str = "INFO"

    # ---- GD behaviour ----
    # Simulated speaking time for AI turns (words per minute). The AI keeps the floor
    # for len(words)/wpm minutes after its text appears (where TTS playback will go
    # in the voice stage). 0 disables the hold.
    ai_speaking_wpm: int = 150
    ai_generation_timeout_seconds: float = 45.0
    ai_hand_raise_multiplier: float = 1.0
    ai_idle_nudge_seconds: float = 4.0
    ai_max_queued: int = 2
    human_queue_priority: bool = True
    max_human_turn_chars: int = 2000

    # ---- Voice (stage 2) ----
    stt_provider: str = "text"  # text | whisper (stub)
    tts_provider: str = "none"  # none

    @property
    def api_key(self) -> str | None:
        return self.llm_api_key or self.groq_api_key

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()] or ["*"]


@lru_cache
def get_settings() -> Settings:
    return Settings()

