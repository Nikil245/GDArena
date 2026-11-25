"""Text-to-speech interface for AI turns (stage 1: disabled).

The runtime already calls :meth:`TextToSpeech.synthesize` for each AI turn and forwards
``audio_url`` in the transcript entry; ``NullTTS`` simply returns ``None``.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from functools import lru_cache

from ..config import get_settings


@dataclass
class Synthesis:
    audio_url: str | None = None
    duration_seconds: float | None = None


class TextToSpeech(ABC):
    name: str = "base"

    @abstractmethod
    async def synthesize(self, text: str, *, voice: str | None = None) -> Synthesis | None:
        ...


class NullTTS(TextToSpeech):
    name = "none"

    async def synthesize(self, text: str, *, voice: str | None = None) -> Synthesis | None:
        return None


@lru_cache
def get_tts() -> TextToSpeech:
    _ = get_settings().tts_provider  # only "none" for now
    return NullTTS()

