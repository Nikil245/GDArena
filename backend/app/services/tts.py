"""Server-side Text-to-Speech (TTS) providers, temp MP3 storage, and startup voice verification.

Swappable via ``TTS_PROVIDER`` in ``backend/.env``:
- ``edge`` (default): Microsoft Edge neural voices via ``edge-tts``.
- ``mock``: offline minimal valid MP3 generator for unit tests.
- ``none``: disables server-side audio synthesis (returns empty bytes).
"""

from __future__ import annotations

import asyncio
import io
import logging
import re
import shutil
import tempfile
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from functools import lru_cache
from pathlib import Path
from typing import Any

import edge_tts
from mutagen.mp3 import MP3

from ..config import Settings, get_settings
from .personas import ALL_PERSONAS

log = logging.getLogger(__name__)

AUDIO_BASE_DIR = Path(tempfile.gettempdir()) / "gd_arena_audio"
_ROOM_CODE_RE = re.compile(r"^[A-Z0-9]{1,12}$")
DEFAULT_TTS_VOICE = "en-US-JennyNeural"
PREFERRED_ENGLISH_LOCALES = ("en-IN", "en-GB", "en-US", "en-AU", "en-CA")


class TTSError(RuntimeError):
    """Raised when TTS synthesis fails."""


class TextToSpeech(ABC):
    name: str = "base"

    @abstractmethod
    async def synthesize(self, text: str, voice: str = DEFAULT_TTS_VOICE, *, rate: str = "+0%") -> bytes:
        """Synthesize ``text`` to MP3 bytes (returns ``b""`` when TTS is disabled)."""
        ...

    def resolve_voice(self, voice: str | None) -> str:
        return voice or DEFAULT_TTS_VOICE


class NullTTS(TextToSpeech):
    name = "none"

    async def synthesize(self, text: str, voice: str = DEFAULT_TTS_VOICE, *, rate: str = "+0%") -> bytes:
        return b""


def _make_silent_mp3(frames: int = 15) -> bytes:
    """Build valid silent MPEG-1 Layer 3 frames (128kbps, 44.1kHz -> ~0.39s for 15 frames)."""
    frame = b"\xff\xfb\x90\x00" + b"\x00" * 413
    return frame * max(1, frames)


class MockTTS(TextToSpeech):
    name = "mock"

    async def synthesize(self, text: str, voice: str = DEFAULT_TTS_VOICE, *, rate: str = "+0%") -> bytes:
        if not text.strip():
            return b""
        return _make_silent_mp3(frames=15)


class EdgeTTS(TextToSpeech):
    """Server-side neural TTS powered by ``edge-tts``."""

    name = "edge"

    def __init__(self, default_voice: str = DEFAULT_TTS_VOICE) -> None:
        self._default_voice = default_voice
        self._voice_overrides: dict[str, str] = {}

    def set_voice_override(self, configured: str, fallback: str) -> None:
        self._voice_overrides[configured] = fallback

    def set_default_voice(self, voice: str) -> None:
        self._default_voice = voice

    def resolve_voice(self, voice: str | None) -> str:
        chosen = voice or self._default_voice
        return self._voice_overrides.get(chosen, chosen)

    async def synthesize(self, text: str, voice: str = DEFAULT_TTS_VOICE, *, rate: str = "+0%") -> bytes:
        clean_text = " ".join(text.split())
        if not clean_text:
            raise TTSError("Cannot synthesize empty text.")
        resolved_voice = self.resolve_voice(voice)
        try:
            communicate = edge_tts.Communicate(text=clean_text, voice=resolved_voice, rate=rate or "+0%")
            chunks: list[bytes] = []
            async for chunk in communicate.stream():
                if chunk.get("type") == "audio" and chunk.get("data"):
                    chunks.append(chunk["data"])
            audio = b"".join(chunks)
        except Exception as exc:
            log.error(
                "EdgeTTS synthesis failed (voice=%s, rate=%s): %s",
                resolved_voice,
                rate,
                exc,
                exc_info=True,
            )
            raise TTSError(f"EdgeTTS synthesis failed: {exc}") from exc

        if not audio:
            raise TTSError(f"EdgeTTS returned empty audio for voice {resolved_voice!r}.")
        return audio


def mp3_duration_seconds(mp3_bytes: bytes) -> float | None:
    """Measure exact MP3 duration in seconds using mutagen."""
    if not mp3_bytes:
        return None
    try:
        info = MP3(io.BytesIO(mp3_bytes)).info
        length = getattr(info, "length", None)
        if length and length > 0:
            return round(float(length), 2)
    except Exception as exc:
        log.warning("Could not read MP3 duration: %s", exc)
    return None


# --------------------------------------------------------------------------------------
# Temporary per-room audio storage
# --------------------------------------------------------------------------------------


def _validate_room_code(room_code: str) -> str:
    clean = room_code.strip().upper()
    if not _ROOM_CODE_RE.match(clean):
        raise ValueError(f"Invalid room code {room_code!r}")
    return clean


def save_turn_audio(
    room_code: str,
    turn_id: int,
    mp3_bytes: bytes,
    *,
    base_dir: Path | None = None,
) -> Path:
    if turn_id <= 0:
        raise ValueError("turn_id must be positive")
    code = _validate_room_code(room_code)
    root = base_dir or AUDIO_BASE_DIR
    room_dir = root / code
    room_dir.mkdir(parents=True, exist_ok=True)
    path = room_dir / f"{turn_id}.mp3"
    path.write_bytes(mp3_bytes)
    return path


def get_turn_audio_path(
    room_code: str,
    turn_id: int,
    *,
    base_dir: Path | None = None,
) -> Path | None:
    if turn_id <= 0:
        return None
    try:
        code = _validate_room_code(room_code)
    except ValueError:
        return None
    root = base_dir or AUDIO_BASE_DIR
    path = root / code / f"{turn_id}.mp3"
    return path if path.is_file() else None


def cleanup_room_audio(room_code: str, *, base_dir: Path | None = None) -> None:
    try:
        code = _validate_room_code(room_code)
    except ValueError:
        return
    root = base_dir or AUDIO_BASE_DIR
    room_dir = root / code
    if room_dir.exists():
        shutil.rmtree(room_dir, ignore_errors=True)
        log.debug("Cleaned up temp audio directory for room %s", code)


# --------------------------------------------------------------------------------------
# Startup voice verification
# --------------------------------------------------------------------------------------


def _rank_english_voice(short_name: str) -> tuple[int, str]:
    for idx, prefix in enumerate(PREFERRED_ENGLISH_LOCALES):
        if short_name.startswith(prefix):
            return (idx, short_name)
    return (len(PREFERRED_ENGLISH_LOCALES), short_name)


async def verify_tts_voices(
    tts: TextToSpeech,
    *,
    list_voices_fn: Callable[[], Awaitable[list[dict[str, Any]]]] | None = None,
) -> dict[str, Any]:
    """Verify configured persona voices against ``edge_tts.list_voices()`` and run a test synthesis."""
    if not isinstance(tts, EdgeTTS):
        msg = f"Startup TTS check: skipped (provider={tts.name})"
        print(msg, flush=True)
        log.info(msg)
        return {"status": "skipped", "provider": tts.name}

    fetcher = list_voices_fn or edge_tts.list_voices
    try:
        voices = await asyncio.wait_for(fetcher(), timeout=15.0)
    except Exception as exc:
        msg = f"FAIL: Startup TTS voice listing failed: {exc}"
        print(msg, flush=True)
        log.error(msg, exc_info=True)
        return {"status": "fail", "error": str(exc)}

    english_voices = sorted(
        {
            str(v.get("ShortName"))
            for v in voices
            if isinstance(v, dict)
            and v.get("ShortName")
            and str(v.get("Locale", "")).lower().startswith("en")
        },
        key=_rank_english_voice,
    )
    all_names = {str(v.get("ShortName")) for v in voices if isinstance(v, dict) and v.get("ShortName")}

    if not english_voices:
        msg = "FAIL: edge_tts.list_voices() returned no English voices."
        print(msg, flush=True)
        log.error(msg)
        return {"status": "fail", "error": "no_english_voices"}

    tts.set_default_voice(english_voices[0])

    found: list[str] = []
    fallbacks: dict[str, str] = {}
    used_fallbacks: set[str] = set()

    for persona in ALL_PERSONAS.values():
        if persona.voice in all_names:
            found.append(f"{persona.name}={persona.voice}")
        else:
            fallback = next((v for v in english_voices if v not in used_fallbacks), english_voices[0])
            used_fallbacks.add(fallback)
            tts.set_voice_override(persona.voice, fallback)
            fallbacks[persona.voice] = fallback
            warn = (
                f"WARN: Edge TTS voice '{persona.voice}' for {persona.name} not found; "
                f"falling back to '{fallback}'."
            )
            print(warn, flush=True)
            log.warning(warn)

    voices_msg = f"OK: Edge TTS voices verified ({len(found)}/{len(ALL_PERSONAS)} exact): {', '.join(found)}"
    print(voices_msg, flush=True)
    log.info(voices_msg)

    # Run a short sample synthesis
    sample_voice = next((p.voice for p in ALL_PERSONAS.values()), english_voices[0])
    try:
        sample_bytes = await asyncio.wait_for(
            tts.synthesize("Hello, GDArena audio check.", voice=sample_voice),
            timeout=15.0,
        )
        dur = mp3_duration_seconds(sample_bytes)
        synth_msg = (
            f"OK: Edge TTS test synthesis succeeded (voice={tts.resolve_voice(sample_voice)}, "
            f"bytes={len(sample_bytes)}, duration={dur}s)."
        )
        print(synth_msg, flush=True)
        log.info(synth_msg)
        return {
            "status": "ok",
            "found": found,
            "fallbacks": fallbacks,
            "sample_bytes": len(sample_bytes),
            "sample_duration": dur,
        }
    except Exception as exc:
        fail_msg = f"FAIL: Edge TTS test synthesis failed: {exc}"
        print(fail_msg, flush=True)
        log.error(fail_msg, exc_info=True)
        return {"status": "fail", "found": found, "fallbacks": fallbacks, "error": str(exc)}


def build_tts(settings: Settings) -> TextToSpeech:
    provider = settings.tts_provider.strip().lower()
    if provider == "edge":
        return EdgeTTS()
    if provider == "mock":
        return MockTTS()
    return NullTTS()


@lru_cache
def get_tts() -> TextToSpeech:
    return build_tts(get_settings())
