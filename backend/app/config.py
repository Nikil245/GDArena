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
    llm_model: str = "openai/gpt-oss-120b"
    llm_fallback_model: str = "qwen/qwen3.6-27b"
    llm_reasoning_effort: str | None = "low"
    llm_timeout_seconds: float = 30.0
    llm_max_retries: int = 1
    llm_backoff_base_seconds: float = 1.0
    llm_backoff_max_seconds: float = 30.0
    llm_max_concurrency: int = 4

    # ---- App ----
    database_url: str = f"sqlite:///{BACKEND_DIR / 'gd_arena.db'}"
    cors_origins: str = "*"
    log_level: str = "INFO"

    # ---- GD behaviour ----
    # Simulated speaking time for AI turns (words per minute). 150 WPM ~= 2.5 words/sec.
    # The AI keeps the floor after its text appears so browser TTS can finish playing.
    ai_speaking_wpm: int = 150
    ai_generation_timeout_seconds: float = 45.0
    ai_hand_raise_multiplier: float = 1.0
    ai_idle_nudge_seconds: float = 2.5
    ai_max_queued: int = 2
    default_turn_limit_seconds: int = 60
    human_queue_priority: bool = True
    max_human_turn_chars: int = 2000

    # ---- Voice ----
    stt_provider: str = "whisper"  # whisper | faster_whisper (stub) | text | mock
    stt_model: str = "whisper-large-v3-turbo"
    stt_fallback_model: str = "whisper-large-v3"
    tts_provider: str = "none"  # none (handled client-side via Web Speech API in stage 2a)

    @property
    def api_key(self) -> str | None:
        return self.llm_api_key or self.groq_api_key

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()] or ["*"]


@lru_cache
def get_settings() -> Settings:
    return Settings()

