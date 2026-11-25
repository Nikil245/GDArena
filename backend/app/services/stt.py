"""Speech-to-text interface (stage 1: text only).

Every human turn flows through :func:`resolve_speech`, so adding voice later only means
implementing :class:`WhisperSTT.transcribe` (or another ``SpeechToText``) and setting
``STT_PROVIDER``. The WS ``submit_turn`` message already accepts ``audio_b64`` + ``mime_type``.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal

from ..config import get_settings


class STTError(Exception):
    pass


class VoiceNotSupportedError(STTError):
    pass


@dataclass
class SpeechInput:
    """What a client submitted for a turn: text now, audio later."""

    text: str | None = None
    audio: bytes | None = None
    mime_type: str | None = None
    language: str = "en"


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


class TextOnlySTT(SpeechToText):
    """Stage 1 provider: no audio support."""

    name = "text"

    async def transcribe(self, audio: bytes, *, mime_type: str | None, language: str = "en") -> Transcription:
        raise VoiceNotSupportedError("Voice input is not enabled yet; send text instead.")


class WhisperSTT(SpeechToText):
    """Placeholder for Whisper (e.g. Groq ``whisper-large-v3`` via ``client.audio.transcriptions``).

    Implementation sketch::

        resp = await client.audio.transcriptions.create(
            model="whisper-large-v3", file=("turn.webm", audio, mime_type), language=language)
        return Transcription(text=resp.text, source="voice", language=language)
    """

    name = "whisper"

    async def transcribe(self, audio: bytes, *, mime_type: str | None, language: str = "en") -> Transcription:
        raise VoiceNotSupportedError("Whisper STT is not implemented yet.")


async def resolve_speech(inp: SpeechInput, stt: SpeechToText) -> Transcription:
    if inp.text is not None:
        return Transcription(text=inp.text, source="text", language=inp.language)
    if inp.audio:
        return await stt.transcribe(inp.audio, mime_type=inp.mime_type, language=inp.language)
    raise STTError("Turn must contain text (or audio, once voice is enabled).")


@lru_cache
def get_stt() -> SpeechToText:
    provider = get_settings().stt_provider.strip().lower()
    if provider == "whisper":
        return WhisperSTT()
    return TextOnlySTT()

