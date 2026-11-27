"""Speech-to-text providers.

Swappable via ``STT_PROVIDER`` in ``backend/.env``:
- ``whisper`` (default): Groq Whisper via OpenAI-compatible ``audio.transcriptions``.
- ``faster_whisper``: placeholder stub for local ``faster-whisper``.
- ``text``: disables audio transcription.
- ``mock``: offline test stub.
"""

from __future__ import annotations

import logging
import math
from abc import ABC, abstractmethod
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal

import httpx
import openai
from openai import AsyncOpenAI

from ..config import Settings, get_settings
from .service_status import (
    STT_RATE_LIMITED_MESSAGE,
    ServiceStatusTracker,
    classify_provider_error,
    get_service_status,
    redact_secrets,
)

log = logging.getLogger(__name__)

_MIME_TO_EXT: dict[str, tuple[str, str]] = {
    "audio/webm": ("turn.webm", "audio/webm"),
    "video/webm": ("turn.webm", "audio/webm"),
    "audio/ogg": ("turn.ogg", "audio/ogg"),
    "audio/mp4": ("turn.m4a", "audio/mp4"),
    "audio/m4a": ("turn.m4a", "audio/mp4"),
    "audio/x-m4a": ("turn.m4a", "audio/mp4"),
    "audio/wav": ("turn.wav", "audio/wav"),
    "audio/x-wav": ("turn.wav", "audio/wav"),
    "audio/mpeg": ("turn.mp3", "audio/mpeg"),
    "audio/mp3": ("turn.mp3", "audio/mpeg"),
    "audio/flac": ("turn.flac", "audio/flac"),
}


class STTError(Exception):
    pass


class STTRateLimitError(STTError):
    """Speech-to-text hit an upstream HTTP 429 rate limit."""

    def __init__(
        self,
        message: str = STT_RATE_LIMITED_MESSAGE,
        *,
        retry_after_seconds: int | None = None,
    ) -> None:
        super().__init__(message)
        self.retry_after_seconds: int | None = retry_after_seconds


class VoiceNotSupportedError(STTError):
    pass


@dataclass
class SpeechInput:
    """What a client submitted for a turn: text now or audio."""

    text: str | None = None
    audio: bytes | None = None
    mime_type: str | None = None
    language: str = "en"
    source: Literal["text", "voice"] = "text"


@dataclass
class Transcription:
    text: str
    source: Literal["text", "voice"]
    language: str | None = None
    confidence: float | None = None
    duration_seconds: float | None = None


class SpeechToText(ABC):
    name: str = "base"

    @abstractmethod
    async def transcribe(self, audio: bytes, *, mime_type: str | None, language: str = "en") -> Transcription:
        ...

    async def aclose(self) -> None:  # pragma: no cover - trivial
        return None


class TextOnlySTT(SpeechToText):
    """Disables audio transcription when ``STT_PROVIDER=text``."""

    name = "text"

    async def transcribe(self, audio: bytes, *, mime_type: str | None, language: str = "en") -> Transcription:
        raise VoiceNotSupportedError("Voice input is disabled (STT_PROVIDER=text); send text instead.")


def _clean_mime_and_filename(mime_type: str | None) -> tuple[str, str]:
    base_mime = (mime_type or "audio/webm").split(";", 1)[0].strip().lower()
    return _MIME_TO_EXT.get(base_mime, ("turn.webm", "audio/webm"))


class GroqWhisperSTT(SpeechToText):
    """Groq Whisper transcription via OpenAI-compatible ``audio.transcriptions``."""

    name = "whisper"

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str = "whisper-large-v3-turbo",
        fallback_model: str | None = None,
        timeout: float = 30.0,
        http_client: httpx.AsyncClient | None = None,
        status_tracker: ServiceStatusTracker | None = None,
    ) -> None:
        self.model = model
        self.fallback_model = fallback_model.strip() if fallback_model and fallback_model.strip() else None
        self._status = status_tracker or get_service_status()
        self._client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
            max_retries=1,
            http_client=http_client,
        )

    def _candidate_models(self) -> list[str]:
        models = [self.model]
        if self.fallback_model and self.fallback_model != self.model:
            models.append(self.fallback_model)
        return models

    async def transcribe(self, audio: bytes, *, mime_type: str | None, language: str = "en") -> Transcription:
        if not audio:
            raise STTError("Audio recording is empty.")
        filename, clean_mime = _clean_mime_and_filename(mime_type)
        candidates = self._candidate_models()
        resp: object | None = None
        last_rate_limit: tuple[int | None, bool, object] | None = None

        for idx, model_name in enumerate(candidates):
            has_next = idx + 1 < len(candidates)
            try:
                resp = await self._client.audio.transcriptions.create(
                    model=model_name,
                    file=(filename, audio, clean_mime),
                    language=language or "en",
                )
                self._status.record_stt_success()
                break
            except openai.RateLimitError as exc:
                classified = classify_provider_error(exc)
                safe_detail = redact_secrets(str(exc))
                retry_secs = (
                    math.ceil(classified.retry_after_seconds)
                    if classified.retry_after_seconds is not None
                    else None
                )
                log.warning(
                    "Whisper STT 429 (model=%s, kind=%s, retry_after=%s, fallback_available=%s): %s",
                    model_name,
                    classified.kind,
                    retry_secs,
                    has_next,
                    safe_detail,
                )
                last_rate_limit = (retry_secs, classified.kind == "quota_exhausted", classified.retry_at)
                if has_next:
                    continue
                if classified.kind == "quota_exhausted":
                    self._status.record_stt_quota_exhausted(classified.retry_at)
                else:
                    self._status.record_stt_degraded(classified.retry_at)
                raise STTRateLimitError(
                    STT_RATE_LIMITED_MESSAGE,
                    retry_after_seconds=retry_secs,
                ) from exc
            except (openai.APITimeoutError, openai.APIConnectionError, openai.InternalServerError) as exc:
                safe_detail = redact_secrets(str(exc))
                log.error(
                    "Whisper STT transient failure (model=%s, mime=%s, fallback_available=%s): %s",
                    model_name,
                    clean_mime,
                    has_next,
                    safe_detail,
                )
                self._status.record_stt_degraded()
                if has_next:
                    continue
                raise STTError(
                    "Speech recognition is temporarily unavailable. Please try again or use text input."
                ) from exc
            except Exception as exc:
                classified = classify_provider_error(exc)
                safe_detail = redact_secrets(str(exc))
                if classified.kind in ("rate_limited_temporary", "quota_exhausted"):
                    retry_secs = (
                        math.ceil(classified.retry_after_seconds)
                        if classified.retry_after_seconds is not None
                        else None
                    )
                    log.warning(
                        "Whisper STT 429 (model=%s, kind=%s, retry_after=%s, fallback_available=%s): %s",
                        model_name,
                        classified.kind,
                        retry_secs,
                        has_next,
                        safe_detail,
                    )
                    if has_next:
                        last_rate_limit = (retry_secs, classified.kind == "quota_exhausted", classified.retry_at)
                        continue
                    if classified.kind == "quota_exhausted":
                        self._status.record_stt_quota_exhausted(classified.retry_at)
                    else:
                        self._status.record_stt_degraded(classified.retry_at)
                    raise STTRateLimitError(
                        STT_RATE_LIMITED_MESSAGE,
                        retry_after_seconds=retry_secs,
                    ) from exc
                log.error(
                    "Whisper STT failed (model=%s, mime=%s): %s",
                    model_name,
                    clean_mime,
                    safe_detail,
                )
                if has_next and last_rate_limit is not None:
                    continue
                raise STTError(
                    "Could not transcribe audio. Please try again or use text input."
                ) from exc

        if resp is None:
            if last_rate_limit is not None:
                retry_secs, is_quota, retry_at = last_rate_limit
                if is_quota:
                    self._status.record_stt_quota_exhausted(retry_at)  # type: ignore[arg-type]
                else:
                    self._status.record_stt_degraded(retry_at)  # type: ignore[arg-type]
                raise STTRateLimitError(
                    STT_RATE_LIMITED_MESSAGE,
                    retry_after_seconds=retry_secs,
                )
            raise STTError("Could not transcribe audio. Please try again or use text input.")

        text = " ".join((getattr(resp, "text", "") or "").split())
        if not text:
            raise STTError("No speech detected in the recording. Please try speaking again.")
        return Transcription(text=text, source="voice", language=language or "en")

    async def aclose(self) -> None:
        await self._client.close()


WhisperSTT = GroqWhisperSTT  # backwards-compatible alias


class FasterWhisperSTT(SpeechToText):
    """Placeholder for local ``faster-whisper`` (swap in via ``STT_PROVIDER=faster_whisper``).

    Implementation sketch::

        from faster_whisper import WhisperModel
        model = WhisperModel("small", device="cpu", compute_type="int8")
        segments, info = model.transcribe(io.BytesIO(audio), language=language)
        return Transcription(text=" ".join(s.text for s in segments).strip(), source="voice")
    """

    name = "faster_whisper"

    async def transcribe(self, audio: bytes, *, mime_type: str | None, language: str = "en") -> Transcription:
        raise VoiceNotSupportedError(
            "Local faster-whisper is not configured yet; set STT_PROVIDER=whisper to use Groq Whisper."
        )


class MockSTT(SpeechToText):
    """Offline mock STT for tests and local dev without an API key."""

    name = "mock"
    model = "mock-whisper"

    async def transcribe(self, audio: bytes, *, mime_type: str | None, language: str = "en") -> Transcription:
        if not audio:
            raise STTError("Audio recording is empty.")
        return Transcription(
            text="I think we should focus on practical implementation and measurable outcomes.",
            source="voice",
            language=language or "en",
        )


async def resolve_speech(inp: SpeechInput, stt: SpeechToText) -> Transcription:
    if inp.text is not None:
        src: Literal["text", "voice"] = "voice" if inp.source == "voice" else "text"
        return Transcription(text=inp.text, source=src, language=inp.language)
    if inp.audio:
        return await stt.transcribe(inp.audio, mime_type=inp.mime_type, language=inp.language)
    raise STTError("Turn must contain text or audio.")


def build_stt(settings: Settings) -> SpeechToText:
    provider = settings.stt_provider.strip().lower()
    if provider == "mock":
        return MockSTT()
    if provider == "faster_whisper":
        return FasterWhisperSTT()
    if provider in ("whisper", "groq", "groq_whisper"):
        if settings.api_key:
            return GroqWhisperSTT(
                api_key=settings.api_key,
                base_url=settings.llm_base_url,
                model=settings.stt_model,
                fallback_model=settings.stt_fallback_model,
            )
        if settings.llm_provider.strip().lower() == "mock":
            return MockSTT()
        log.warning("No API key for Whisper STT; falling back to TextOnlySTT.")
        return TextOnlySTT()
    return TextOnlySTT()


@lru_cache
def get_stt() -> SpeechToText:
    return build_stt(get_settings())
