"""Server-side Text-to-Speech (TTS) providers, audio formatting, temp storage, and startup verification.

Swappable via ``TTS_PROVIDER`` in ``backend/.env``:
- ``groq`` (default): Groq Orpheus (``canopylabs/orpheus-v1-english``) WAV synthesis with
  automatic retry + fallback to Microsoft Edge neural voices (``edge-tts``) and 60s
  failure cooldown.
- ``edge``: Microsoft Edge neural voices via ``edge-tts`` (MP3).
- ``mock``: offline minimal valid MP3 generator for unit tests.
- ``none``: disables server-side audio synthesis.

When ``TTS_ACCENT_PREFERENCE=indian``, Edge ``en-IN`` neural voices (``en-IN-NeerjaNeural``,
``en-IN-PrabhatNeural``, ``en-IN-NeerjaExpressiveNeural``) are preferred for personas
because Groq Orpheus offers general English voices without dedicated Indian accents.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import re
import shutil
import tempfile
import time
import wave
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import edge_tts
import httpx
from mutagen.mp3 import MP3

from ..config import Settings, get_settings
from .personas import ALL_PERSONAS, Persona

log = logging.getLogger(__name__)

AUDIO_BASE_DIR = Path(tempfile.gettempdir()) / "gd_arena_audio"
_ROOM_CODE_RE = re.compile(r"^[A-Z0-9]{1,12}$")

DEFAULT_TTS_VOICE = "en-US-JennyNeural"
DEFAULT_GROQ_VOICE = "diana"
DEFAULT_GROQ_TTS_MODEL = "canopylabs/orpheus-v1-english"
GROQ_ORPHEUS_VOICES: tuple[str, ...] = (
    "autumn",
    "diana",
    "hannah",
    "austin",
    "daniel",
    "troy",
)
GROQ_ORPHEUS_MAX_CHARS = 200
PREFERRED_ENGLISH_LOCALES = ("en-IN", "en-GB", "en-US", "en-AU", "en-CA")

# Subset of bracketed vocal directions documented for Orpheus on Groq.
ALLOWED_VOCAL_DIRECTIONS: frozenset[str] = frozenset(
    {
        "cheerful",
        "serious",
        "thoughtful",
        "excited",
        "professionally",
        "dramatic",
        "sarcastic",
        "whisper",
    }
)

_BRACKET_TAG_RE = re.compile(r"\[([^\[\]]{1,40})\]")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
_ABBREV_WORDS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\be\.g\.", re.IGNORECASE), "for example"),
    (re.compile(r"\bi\.e\.", re.IGNORECASE), "that is"),
    (re.compile(r"\betc\.", re.IGNORECASE), "and so on"),
    (re.compile(r"\bapprox\.", re.IGNORECASE), "approximately"),
    (re.compile(r"\bvs\.?(?=\s|$)", re.IGNORECASE), "versus"),
    (re.compile(r"\bgovt\.?(?=\s|$)", re.IGNORECASE), "government"),
    (re.compile(r"\bdept\.?(?=\s|$)", re.IGNORECASE), "department"),
    (re.compile(r"\bavg\.?(?=\s|$)", re.IGNORECASE), "average"),
    (re.compile(r"\bmin\.", re.IGNORECASE), "minimum"),
    (re.compile(r"\bmax\.", re.IGNORECASE), "maximum"),
    (re.compile(r"\bw/o\b", re.IGNORECASE), "without"),
    (re.compile(r"\band/or\b", re.IGNORECASE), "and or"),
    (re.compile(r"\b24/7\b"), "twenty four seven"),
]
_EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001FAFF"
    "\U00002600-\U000027BF"
    "\U0000FE00-\U0000FE0F"
    "\U0001F1E6-\U0001F1FF"
    "]+",
    flags=re.UNICODE,
)


class TTSError(RuntimeError):
    """Raised when TTS synthesis fails."""


class TTSAccessError(TTSError):
    """Non-retryable provider error (400 model_terms_required, 401/403/404, invalid params)."""


@dataclass(frozen=True)
class SynthesizedAudio:
    data: bytes
    media_type: str
    ext: str
    provider: str
    voice: str
    duration_seconds: float | None


# --------------------------------------------------------------------------------------
# Text normalization & chunking
# --------------------------------------------------------------------------------------


def strip_vocal_directions(text: str) -> str:
    """Remove all bracketed vocal direction cues like ``[cheerful]`` for display, scoring, or Edge TTS."""
    cleaned = _BRACKET_TAG_RE.sub(" ", text)
    cleaned = re.sub(r"\s+([,.!?;:])", r"\1", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def _replace_currency_and_symbols(text: str) -> str:
    scale_words = {
        "m": "million",
        "mn": "million",
        "b": "billion",
        "bn": "billion",
        "k": "thousand",
        "l": "lakh",
        "cr": "crore",
    }

    def _usd(match: re.Match[str]) -> str:
        amt = match.group(1)
        unit = (match.group(2) or "").strip()
        if unit:
            expanded = scale_words.get(unit.lower(), unit)
            return f"{amt} {expanded} dollars"
        return f"{amt} dollars"

    def _inr(match: re.Match[str]) -> str:
        amt = match.group(1)
        unit = (match.group(2) or "").strip()
        if unit:
            expanded = scale_words.get(unit.lower(), unit)
            return f"{amt} {expanded} rupees"
        return f"{amt} rupees"

    out = re.sub(
        r"\$\s*(\d[\d.,]*)\s*(million|billion|thousand|mn|bn|m|b|k)?\b",
        _usd,
        text,
        flags=re.IGNORECASE,
    )
    out = re.sub(
        r"(?:₹|Rs\.?)\s*(\d[\d.,]*)\s*(crores?|lakhs?|million|billion|cr|l)?\b",
        _inr,
        out,
        flags=re.IGNORECASE,
    )
    out = re.sub(r"(\d[\d.,]*)\s*%", r"\1 percent", out)
    out = out.replace("%", " percent ")
    out = out.replace("&", " and ")
    out = out.replace("+", " plus ")
    return out


def prepare_text_for_tts(text: str, *, allow_vocal_directions: bool = True) -> str:
    """Clean markdown, emojis, abbreviations, and symbols so TTS reads natural English."""
    if not text:
        return ""

    preserved_tags: list[str] = []

    def _handle_bracket(match: re.Match[str]) -> str:
        inner = " ".join(match.group(1).strip().lower().split())
        if allow_vocal_directions and inner in ALLOWED_VOCAL_DIRECTIONS:
            token = f"\x00VOCALTAG{len(preserved_tags)}\x00"
            preserved_tags.append(f"[{inner}]")
            return f" {token} "
        return " "

    out = _BRACKET_TAG_RE.sub(_handle_bracket, text)
    out = _EMOJI_RE.sub(" ", out)

    # Markdown bullets / headings / formatting markers
    out = re.sub(r"(?m)^\s*(?:[-*]|\d+[.)]|#+)\s+", "", out)
    out = re.sub(r"[*_`~#>|]+", " ", out)

    # Parentheses & dashes -> gentle spoken pauses
    out = re.sub(r"\(([^)]*)\)", r", \1, ", out)
    out = out.replace("—", ", ").replace("–", ", ")
    out = re.sub(r"\s+-\s+", ", ", out)

    # Symbols & abbreviations
    out = _replace_currency_and_symbols(out)
    for pattern, repl in _ABBREV_WORDS:
        out = pattern.sub(repl, out)

    for idx, tag in enumerate(preserved_tags):
        out = out.replace(f"\x00VOCALTAG{idx}\x00", tag)

    # Collapse spaces & stray punctuation spacing
    out = re.sub(r"\s+([,.!?;:])", r"\1", out)
    out = re.sub(r",\s*,+", ", ", out)
    out = re.sub(r"^[,.;:\s]+", "", out)
    return re.sub(r"\s+", " ", out).strip()


def _split_oversized_segment(segment: str, max_chars: int) -> list[str]:
    """Break a single sentence exceeding ``max_chars`` on clauses or word boundaries."""
    if len(segment) <= max_chars:
        return [segment]

    # Split on clause punctuation first while packing up to max_chars.
    clauses = [c.strip() for c in re.split(r"(?<=[,;:])\s+", segment) if c.strip()]
    if len(clauses) > 1 and all(len(c) <= max_chars for c in clauses):
        packed: list[str] = []
        current = ""
        for clause in clauses:
            candidate = f"{current} {clause}".strip() if current else clause
            if len(candidate) <= max_chars:
                current = candidate
            else:
                if current:
                    packed.append(current)
                current = clause
        if current:
            packed.append(current)
        return packed

    # Last resort: pack words (keeping "[tag] nextword" or single tokens intact).
    tokens = re.findall(r"\[[^\[\]]+\]|\S+", segment)
    chunks: list[str] = []
    current = ""
    for tok in tokens:
        if len(tok) > max_chars:
            if current:
                chunks.append(current)
                current = ""
            for i in range(0, len(tok), max_chars):
                chunks.append(tok[i : i + max_chars])
            continue
        candidate = f"{current} {tok}".strip() if current else tok
        if len(candidate) <= max_chars:
            current = candidate
        else:
            if current:
                chunks.append(current)
            current = tok
    if current:
        chunks.append(current)
    return chunks


def split_text_for_tts(text: str, max_chars: int = GROQ_ORPHEUS_MAX_CHARS) -> list[str]:
    """Split text cleanly at sentence boundaries so every chunk stays within ``max_chars``."""
    clean = " ".join(text.split())
    if not clean:
        return []
    if len(clean) <= max_chars:
        return [clean]

    sentences = [s.strip() for s in _SENTENCE_SPLIT_RE.split(clean) if s.strip()]
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        if len(sentence) > max_chars:
            if current:
                chunks.append(current)
                current = ""
            chunks.extend(_split_oversized_segment(sentence, max_chars))
            continue
        candidate = f"{current} {sentence}".strip() if current else sentence
        if len(candidate) <= max_chars:
            current = candidate
        else:
            if current:
                chunks.append(current)
            current = sentence
    if current:
        chunks.append(current)
    return chunks


# --------------------------------------------------------------------------------------
# Audio format helpers (WAV & MP3)
# --------------------------------------------------------------------------------------


def _make_silent_mp3(frames: int = 15) -> bytes:
    """Build valid silent MPEG-1 Layer 3 frames (128kbps, 44.1kHz -> ~0.39s for 15 frames)."""
    frame = b"\xff\xfb\x90\x00" + b"\x00" * 413
    return frame * max(1, frames)


def _make_silent_wav(duration_seconds: float = 0.5, sample_rate: int = 24000) -> bytes:
    """Build valid silent PCM 16-bit mono WAV bytes for tests."""
    nframes = max(1, int(round(duration_seconds * sample_rate)))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(b"\x00" * (nframes * 2))
    return buf.getvalue()


def detect_audio_format(data: bytes) -> tuple[str, str]:
    """Inspect magic bytes and return ``(media_type, ext)``."""
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return ("audio/wav", "wav")
    return ("audio/mpeg", "mp3")


def wav_duration_seconds(wav_bytes: bytes) -> float | None:
    """Measure exact WAV duration in seconds via Python's ``wave`` module."""
    if not wav_bytes:
        return None
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            if frames > 0 and rate > 0:
                return round(frames / float(rate), 2)
    except Exception as exc:
        log.warning("Could not read WAV duration: %s", exc)
    return None


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


def audio_duration_seconds(audio_bytes: bytes) -> float | None:
    """Compute exact playback duration for WAV or MP3 bytes."""
    if not audio_bytes:
        return None
    _, ext = detect_audio_format(audio_bytes)
    if ext == "wav":
        return wav_duration_seconds(audio_bytes)
    return mp3_duration_seconds(audio_bytes)


def join_wav_chunks(chunks: list[bytes], *, pause_ms: int = 80) -> bytes:
    """Join multiple WAV clips (same PCM params) with a brief natural gap."""
    if not chunks:
        raise TTSError("No WAV chunks to join.")
    if len(chunks) == 1:
        return chunks[0]

    params: tuple[int, int, int] | None = None
    pcm_parts: list[bytes] = []
    silence_gap = b""

    for idx, raw in enumerate(chunks):
        try:
            with wave.open(io.BytesIO(raw), "rb") as wf:
                cur_params = (wf.getnchannels(), wf.getsampwidth(), wf.getframerate())
                frames = wf.readframes(wf.getnframes())
        except Exception as exc:
            raise TTSError(f"Invalid WAV chunk at index {idx}: {exc}") from exc

        if params is None:
            params = cur_params
            nchannels, sampwidth, framerate = params
            if pause_ms > 0:
                gap_frames = max(0, int(framerate * pause_ms / 1000))
                silence_gap = b"\x00" * (gap_frames * nchannels * sampwidth)
        elif cur_params != params:
            raise TTSError(
                f"Mismatched WAV parameters across chunks: expected {params}, got {cur_params}"
            )

        if idx > 0 and silence_gap:
            pcm_parts.append(silence_gap)
        pcm_parts.append(frames)

    assert params is not None
    out = io.BytesIO()
    with wave.open(out, "wb") as wf:
        wf.setnchannels(params[0])
        wf.setsampwidth(params[1])
        wf.setframerate(params[2])
        wf.writeframes(b"".join(pcm_parts))
    return out.getvalue()


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
    audio_bytes: bytes,
    *,
    ext: str | None = None,
    base_dir: Path | None = None,
) -> Path:
    if turn_id <= 0:
        raise ValueError("turn_id must be positive")
    code = _validate_room_code(room_code)
    chosen_ext = (ext or detect_audio_format(audio_bytes)[1]).lstrip(".").lower()
    if chosen_ext not in {"wav", "mp3"}:
        chosen_ext = "mp3"
    root = base_dir or AUDIO_BASE_DIR
    room_dir = root / code
    room_dir.mkdir(parents=True, exist_ok=True)
    path = room_dir / f"{turn_id}.{chosen_ext}"
    path.write_bytes(audio_bytes)
    return path


def get_turn_audio_path(
    room_code: str,
    turn_id: int,
    *,
    ext: str | None = None,
    base_dir: Path | None = None,
) -> Path | None:
    if turn_id <= 0:
        return None
    try:
        code = _validate_room_code(room_code)
    except ValueError:
        return None
    root = base_dir or AUDIO_BASE_DIR
    if ext is not None:
        clean_ext = ext.lstrip(".").lower()
        if clean_ext not in {"wav", "mp3"}:
            return None
        path = root / code / f"{turn_id}.{clean_ext}"
        return path if path.is_file() else None

    for candidate_ext in ("wav", "mp3"):
        path = root / code / f"{turn_id}.{candidate_ext}"
        if path.is_file():
            return path
    return None


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
# Provider interface & implementations
# --------------------------------------------------------------------------------------


class TextToSpeech(ABC):
    name: str = "base"

    @abstractmethod
    async def synthesize(
        self, text: str, voice: str = DEFAULT_TTS_VOICE, *, rate: str = "+0%"
    ) -> bytes:
        """Synthesize ``text`` to audio bytes (WAV or MP3; ``b""`` when disabled)."""
        ...

    def resolve_voice(self, voice: str | None) -> str:
        return voice or DEFAULT_TTS_VOICE

    async def aclose(self) -> None:
        return None

    async def synthesize_for_persona(
        self,
        text: str,
        *,
        persona: Persona | None = None,
        voice: str | None = None,
        rate: str | None = None,
        provider_override: str | None = None,
    ) -> SynthesizedAudio | None:
        chosen_voice = voice or (persona.voice if persona else DEFAULT_TTS_VOICE)
        chosen_rate = rate or (persona.rate if persona else "+0%")
        data = await self.synthesize(text, voice=chosen_voice, rate=chosen_rate)
        if not data:
            return None
        media_type, ext = detect_audio_format(data)
        return SynthesizedAudio(
            data=data,
            media_type=media_type,
            ext=ext,
            provider=self.name,
            voice=self.resolve_voice(chosen_voice),
            duration_seconds=audio_duration_seconds(data),
        )


class NullTTS(TextToSpeech):
    name = "none"

    async def synthesize(
        self, text: str, voice: str = DEFAULT_TTS_VOICE, *, rate: str = "+0%"
    ) -> bytes:
        return b""


class MockTTS(TextToSpeech):
    name = "mock"

    async def synthesize(
        self, text: str, voice: str = DEFAULT_TTS_VOICE, *, rate: str = "+0%"
    ) -> bytes:
        if not text.strip():
            return b""
        return _make_silent_mp3(frames=15)


class EdgeTTS(TextToSpeech):
    """Server-side neural TTS powered by ``edge-tts``."""

    name = "edge"

    def __init__(
        self,
        default_voice: str = DEFAULT_TTS_VOICE,
        *,
        accent_preference: str = "neutral",
        voice_overrides: dict[str, str] | None = None,
    ) -> None:
        self._default_voice = default_voice
        self._accent_preference = accent_preference.strip().lower()
        self._voice_map_overrides = {
            k.strip().lower(): v.strip()
            for k, v in (voice_overrides or {}).items()
            if k.strip() and v.strip()
        }
        self._runtime_voice_fallbacks: dict[str, str] = {}

    def set_voice_override(self, configured: str, fallback: str) -> None:
        self._runtime_voice_fallbacks[configured] = fallback

    def set_default_voice(self, voice: str) -> None:
        self._default_voice = voice

    def resolve_voice(self, voice: str | None) -> str:
        chosen = voice or self._default_voice
        return self._runtime_voice_fallbacks.get(chosen, chosen)

    def persona_voice_and_rate(self, persona: Persona | None) -> tuple[str, str]:
        if persona is None:
            fallback = "en-IN-NeerjaNeural" if self._accent_preference == "indian" else self._default_voice
            return (self.resolve_voice(fallback), "+0%")

        mapped = self._voice_map_overrides.get(persona.key)
        if mapped and mapped.lower() not in GROQ_ORPHEUS_VOICES:
            raw_voice = mapped
            rate = persona.indian_rate if self._accent_preference == "indian" else persona.rate
        elif self._accent_preference == "indian":
            raw_voice = persona.indian_voice
            rate = persona.indian_rate
        else:
            raw_voice = persona.voice
            rate = persona.rate
        return (self.resolve_voice(raw_voice), rate)

    async def synthesize(
        self, text: str, voice: str = DEFAULT_TTS_VOICE, *, rate: str = "+0%"
    ) -> bytes:
        clean_text = prepare_text_for_tts(text, allow_vocal_directions=False)
        if not clean_text:
            raise TTSError("Cannot synthesize empty text.")
        resolved_voice = self.resolve_voice(voice)
        try:
            communicate = edge_tts.Communicate(
                text=clean_text, voice=resolved_voice, rate=rate or "+0%"
            )
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

    async def synthesize_for_persona(
        self,
        text: str,
        *,
        persona: Persona | None = None,
        voice: str | None = None,
        rate: str | None = None,
        provider_override: str | None = None,
    ) -> SynthesizedAudio | None:
        p_voice, p_rate = self.persona_voice_and_rate(persona)
        chosen_voice = self.resolve_voice(voice) if voice else p_voice
        chosen_rate = rate or p_rate
        data = await self.synthesize(text, voice=chosen_voice, rate=chosen_rate)
        if not data:
            return None
        return SynthesizedAudio(
            data=data,
            media_type="audio/mpeg",
            ext="mp3",
            provider=self.name,
            voice=chosen_voice,
            duration_seconds=mp3_duration_seconds(data),
        )


class GroqOrpheusTTS(TextToSpeech):
    """Natural human-like English TTS using Groq's Canopy Labs Orpheus model (WAV)."""

    name = "groq"

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = "https://api.groq.com/openai/v1",
        model: str = DEFAULT_GROQ_TTS_MODEL,
        default_voice: str = DEFAULT_GROQ_VOICE,
        timeout: float = 20.0,
        backoff_seconds: float = 0.5,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("GroqOrpheusTTS requires an API key")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.default_voice = (
            default_voice.lower()
            if default_voice.lower() in GROQ_ORPHEUS_VOICES
            else DEFAULT_GROQ_VOICE
        )
        self.timeout = timeout
        self.backoff_seconds = backoff_seconds
        self._owns_client = http_client is None
        self._http = http_client or httpx.AsyncClient(timeout=timeout)

    async def aclose(self) -> None:
        if self._owns_client:
            await self._http.aclose()

    def resolve_voice(self, voice: str | None) -> str:
        if voice:
            lower = voice.strip().lower()
            if lower in GROQ_ORPHEUS_VOICES:
                return lower
        return self.default_voice

    async def _synthesize_chunk(self, chunk: str, voice: str) -> bytes:
        url = f"{self.base_url}/audio/speech"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "input": chunk,
            "voice": voice,
            "response_format": "wav",
        }

        last_err: Exception | None = None
        for attempt in range(2):
            try:
                resp = await self._http.post(
                    url, headers=headers, json=payload, timeout=self.timeout
                )
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_err = exc
                log.warning(
                    "Groq TTS request failed (attempt %d/2, model=%s, voice=%s): %s",
                    attempt + 1,
                    self.model,
                    voice,
                    exc,
                )
                if attempt == 0:
                    await asyncio.sleep(self.backoff_seconds)
                    continue
                raise TTSError(f"Groq TTS network/timeout error: {exc}") from exc

            if resp.status_code == 200:
                if not resp.content:
                    raise TTSError("Groq TTS returned empty audio body.")
                return resp.content

            body_text = _extract_error_detail(resp)
            if resp.status_code in {400, 401, 403, 404}:
                hint = ""
                if "model_terms_required" in body_text.lower() or "terms" in body_text.lower():
                    hint = (
                        " Accept model terms at "
                        "https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english ."
                    )
                raise TTSAccessError(
                    f"Groq TTS error {resp.status_code} ({self.model}): {body_text}.{hint}"
                )

            if resp.status_code == 429 or resp.status_code >= 500:
                last_err = TTSError(f"Groq TTS HTTP {resp.status_code}: {body_text}")
                log.warning(
                    "Groq TTS HTTP %d (attempt %d/2, model=%s, voice=%s): %s",
                    resp.status_code,
                    attempt + 1,
                    self.model,
                    voice,
                    body_text,
                )
                if attempt == 0:
                    delay = _retry_after_delay(resp.headers.get("retry-after"), self.backoff_seconds)
                    await asyncio.sleep(delay)
                    continue
                raise last_err

            raise TTSError(f"Groq TTS error {resp.status_code}: {body_text}")

        raise TTSError(f"Groq TTS failed: {last_err}")

    async def synthesize(
        self, text: str, voice: str = DEFAULT_GROQ_VOICE, *, rate: str = "+0%"
    ) -> bytes:
        clean_text = prepare_text_for_tts(text, allow_vocal_directions=True)
        if not clean_text:
            raise TTSError("Cannot synthesize empty text.")
        resolved_voice = self.resolve_voice(voice)
        chunks = split_text_for_tts(clean_text, max_chars=GROQ_ORPHEUS_MAX_CHARS)
        wav_parts: list[bytes] = []
        for chunk in chunks:
            wav_parts.append(await self._synthesize_chunk(chunk, resolved_voice))
        return join_wav_chunks(wav_parts)


class FallbackTTS(TextToSpeech):
    """Uses Groq Orpheus as primary TTS with automatic retry, 60s failure cooldown, and Edge TTS fallback."""

    def __init__(
        self,
        *,
        primary: GroqOrpheusTTS,
        fallback: EdgeTTS,
        accent_preference: str = "neutral",
        cooldown_seconds: float = 60.0,
        voice_overrides: dict[str, str] | None = None,
        failure_threshold: int = 2,
    ) -> None:
        self.primary = primary
        self.fallback = fallback
        self.accent_preference = accent_preference.strip().lower()
        self.cooldown_seconds = cooldown_seconds
        self.failure_threshold = max(1, failure_threshold)
        self.voice_overrides = {
            k.strip().lower(): v.strip()
            for k, v in (voice_overrides or {}).items()
            if k.strip() and v.strip()
        }
        self._consecutive_failures = 0
        self._primary_disabled_until = 0.0
        self._last_error: str | None = None

    @property
    def name(self) -> str:  # type: ignore[override]
        return "edge" if self.accent_preference == "indian" else "groq"

    @property
    def model(self) -> str | None:
        return None if self.accent_preference == "indian" else self.primary.model

    @property
    def is_primary_in_cooldown(self) -> bool:
        return time.monotonic() < self._primary_disabled_until

    def trip_primary_cooldown(self, reason: str | None = None) -> None:
        self._primary_disabled_until = time.monotonic() + self.cooldown_seconds
        if reason:
            self._last_error = reason
        log.warning(
            "Skipping Groq TTS for %.0fs after failures (%s); using Edge TTS fallback.",
            self.cooldown_seconds,
            reason or "provider error",
        )

    def resolve_voice(self, voice: str | None) -> str:
        if self.accent_preference == "indian":
            return self.fallback.resolve_voice(voice)
        if voice and voice.strip().lower() in GROQ_ORPHEUS_VOICES:
            return self.primary.resolve_voice(voice)
        return self.fallback.resolve_voice(voice)

    async def aclose(self) -> None:
        await self.primary.aclose()

    def _resolve_groq_voice(self, persona: Persona | None, voice: str | None) -> str | None:
        if voice:
            lower = voice.strip().lower()
            if lower in GROQ_ORPHEUS_VOICES:
                return lower
            return None
        if persona is not None:
            override = self.voice_overrides.get(persona.key)
            if override:
                lower = override.lower()
                return lower if lower in GROQ_ORPHEUS_VOICES else None
            return persona.groq_voice
        return self.primary.default_voice

    async def _synthesize_edge(
        self,
        text: str,
        *,
        persona: Persona | None,
        voice: str | None,
        rate: str | None,
        indian: bool = False,
    ) -> SynthesizedAudio:
        if indian and persona is not None:
            edge_voice = self.fallback.resolve_voice(voice or persona.indian_voice)
            edge_rate = rate or persona.indian_rate
        elif persona is not None:
            override = self.voice_overrides.get(persona.key)
            raw_edge = voice or (
                override if override and override.lower() not in GROQ_ORPHEUS_VOICES else persona.voice
            )
            edge_voice = self.fallback.resolve_voice(raw_edge)
            edge_rate = rate or persona.rate
        else:
            edge_voice = self.fallback.resolve_voice(
                "en-IN-NeerjaNeural" if indian else voice
            )
            edge_rate = rate or "+0%"

        clean_for_edge = prepare_text_for_tts(text, allow_vocal_directions=False)
        data = await self.fallback.synthesize(clean_for_edge, voice=edge_voice, rate=edge_rate)
        return SynthesizedAudio(
            data=data,
            media_type="audio/mpeg",
            ext="mp3",
            provider="edge",
            voice=edge_voice,
            duration_seconds=mp3_duration_seconds(data),
        )

    async def synthesize(
        self, text: str, voice: str = DEFAULT_GROQ_VOICE, *, rate: str = "+0%"
    ) -> bytes:
        result = await self.synthesize_for_persona(text, voice=voice, rate=rate)
        return result.data if result else b""

    async def synthesize_for_persona(
        self,
        text: str,
        *,
        persona: Persona | None = None,
        voice: str | None = None,
        rate: str | None = None,
        provider_override: str | None = None,
    ) -> SynthesizedAudio | None:
        override_prov = provider_override.strip().lower() if provider_override else None

        if override_prov == "edge":
            return await self._synthesize_edge(
                text,
                persona=persona,
                voice=voice,
                rate=rate,
                indian=self.accent_preference == "indian",
            )

        if override_prov == "groq":
            groq_voice = self._resolve_groq_voice(persona, voice) or self.primary.default_voice
            data = await self.primary.synthesize(text, voice=groq_voice)
            return SynthesizedAudio(
                data=data,
                media_type="audio/wav",
                ext="wav",
                provider="groq",
                voice=groq_voice,
                duration_seconds=wav_duration_seconds(data),
            )

        # Indian accent preference intentionally routes personas through Edge en-IN voices.
        if self.accent_preference == "indian":
            return await self._synthesize_edge(
                text, persona=persona, voice=voice, rate=rate, indian=True
            )

        groq_voice = self._resolve_groq_voice(persona, voice)
        if not groq_voice:
            # Personas 7-10 intentionally use distinct Edge voices instead of colliding on 6 Orpheus voices.
            return await self._synthesize_edge(text, persona=persona, voice=voice, rate=rate)

        if self.is_primary_in_cooldown:
            log.debug("Groq TTS in 60s cooldown; using Edge fallback for persona=%s", persona.key if persona else None)
            return await self._synthesize_edge(text, persona=persona, voice=None, rate=rate)

        try:
            data = await self.primary.synthesize(text, voice=groq_voice)
            self._consecutive_failures = 0
            self._primary_disabled_until = 0.0
            self._last_error = None
            return SynthesizedAudio(
                data=data,
                media_type="audio/wav",
                ext="wav",
                provider="groq",
                voice=groq_voice,
                duration_seconds=wav_duration_seconds(data),
            )
        except TTSAccessError as exc:
            log.error("Groq TTS access/terms failure (voice=%s): %s", groq_voice, exc)
            self._consecutive_failures += 1
            self.trip_primary_cooldown(str(exc))
            return await self._synthesize_edge(text, persona=persona, voice=None, rate=rate)
        except Exception as exc:
            log.error("Groq TTS failed (voice=%s); falling back to Edge TTS: %s", groq_voice, exc)
            self._consecutive_failures += 1
            self._last_error = str(exc)
            if self._consecutive_failures >= self.failure_threshold:
                self.trip_primary_cooldown(str(exc))
            return await self._synthesize_edge(text, persona=persona, voice=None, rate=rate)


def _extract_error_detail(resp: httpx.Response) -> str:
    try:
        data = resp.json()
        err = data.get("error") if isinstance(data, dict) else None
        if isinstance(err, dict):
            code = err.get("code")
            msg = err.get("message") or str(err)
            return f"{code}: {msg}" if code else str(msg)
    except Exception:
        pass
    return resp.text[:300]


def _retry_after_delay(header: str | None, default_delay: float) -> float:
    if header is not None:
        try:
            return min(2.0, max(0.0, float(header)))
        except ValueError:
            pass
    return default_delay


# --------------------------------------------------------------------------------------
# Startup verification
# --------------------------------------------------------------------------------------


def _rank_english_voice(short_name: str) -> tuple[int, str]:
    for idx, prefix in enumerate(PREFERRED_ENGLISH_LOCALES):
        if short_name.startswith(prefix):
            return (idx, short_name)
    return (len(PREFERRED_ENGLISH_LOCALES), short_name)


async def _verify_edge_voices(
    edge: EdgeTTS,
    *,
    list_voices_fn: Callable[[], Awaitable[list[dict[str, Any]]]] | None = None,
    run_sample: bool = True,
) -> dict[str, Any]:
    fetcher = list_voices_fn or edge_tts.list_voices
    try:
        voices = await asyncio.wait_for(fetcher(), timeout=15.0)
    except Exception as exc:
        msg = f"FAIL: Startup Edge TTS voice listing failed: {exc}"
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
    all_names = {
        str(v.get("ShortName"))
        for v in voices
        if isinstance(v, dict) and v.get("ShortName")
    }

    if not english_voices:
        msg = "FAIL: edge_tts.list_voices() returned no English voices."
        print(msg, flush=True)
        log.error(msg)
        return {"status": "fail", "error": "no_english_voices"}

    edge.set_default_voice(english_voices[0])

    found: list[str] = []
    fallbacks: dict[str, str] = {}
    used_fallbacks: set[str] = set()
    use_indian = getattr(edge, "_accent_preference", "neutral") == "indian"

    for persona in ALL_PERSONAS.values():
        target_voice = persona.indian_voice if use_indian else persona.voice
        if target_voice in all_names:
            found.append(f"{persona.name}={target_voice}")
        else:
            fallback = next(
                (v for v in english_voices if v not in used_fallbacks),
                english_voices[0],
            )
            used_fallbacks.add(fallback)
            edge.set_voice_override(target_voice, fallback)
            fallbacks[target_voice] = fallback
            warn = (
                f"WARN: Edge TTS voice '{target_voice}' for {persona.name} not found; "
                f"falling back to '{fallback}'."
            )
            print(warn, flush=True)
            log.warning(warn)

    voices_msg = (
        f"OK: Edge TTS voices verified ({len(found)}/{len(ALL_PERSONAS)} exact): "
        f"{', '.join(found)}"
    )
    print(voices_msg, flush=True)
    log.info(voices_msg)

    result: dict[str, Any] = {"status": "ok", "found": found, "fallbacks": fallbacks}
    if not run_sample:
        return result

    sample_voice = next(
        (p.indian_voice if use_indian else p.voice for p in ALL_PERSONAS.values()),
        english_voices[0],
    )
    try:
        sample_bytes = await asyncio.wait_for(
            edge.synthesize("Hello, GDArena audio check.", voice=sample_voice),
            timeout=15.0,
        )
        dur = mp3_duration_seconds(sample_bytes)
        synth_msg = (
            f"OK: Edge TTS test synthesis succeeded (voice={edge.resolve_voice(sample_voice)}, "
            f"bytes={len(sample_bytes)}, duration={dur}s)."
        )
        print(synth_msg, flush=True)
        log.info(synth_msg)
        result["sample_bytes"] = len(sample_bytes)
        result["sample_duration"] = dur
        return result
    except Exception as exc:
        fail_msg = f"FAIL: Edge TTS test synthesis failed: {exc}"
        print(fail_msg, flush=True)
        log.error(fail_msg, exc_info=True)
        result["status"] = "fail"
        result["error"] = str(exc)
        return result


async def verify_tts_voices(
    tts: TextToSpeech,
    settings: Settings | None = None,
    *,
    list_voices_fn: Callable[[], Awaitable[list[dict[str, Any]]]] | None = None,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Verify TTS model/voices at startup and run a short sample synthesis."""
    cfg = settings or get_settings()

    if isinstance(tts, FallbackTTS):
        if tts.accent_preference == "indian":
            accent_msg = (
                "Startup TTS: accent_preference=indian -> using Edge en-IN neural voices "
                "(Groq Orpheus has general English voices without dedicated Indian accents)."
            )
            print(accent_msg, flush=True)
            log.info(accent_msg)
            edge_res = await _verify_edge_voices(
                tts.fallback, list_voices_fn=list_voices_fn, run_sample=True
            )
            return {"provider": "edge", "accent_preference": "indian", **edge_res}

        # 1. Check /models for configured Groq TTS model
        models_url = f"{tts.primary.base_url}/models"
        headers = {"Authorization": f"Bearer {tts.primary.api_key}"}
        model_available: bool | None = None
        try:
            if http_client is not None:
                resp = await http_client.get(models_url, headers=headers, timeout=10.0)
            else:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(models_url, headers=headers)
            resp.raise_for_status()
            available = {
                str(item["id"])
                for item in resp.json().get("data", [])
                if isinstance(item, dict) and item.get("id")
            }
            model_available = tts.primary.model in available
            if model_available:
                msg = f"OK: Groq TTS model '{tts.primary.model}' is available at {models_url}."
                print(msg, flush=True)
                log.info(msg)
            else:
                msg = (
                    f"WARN: Groq TTS model '{tts.primary.model}' was not listed in {models_url}; "
                    "testing direct /audio/speech synthesis."
                )
                print(msg, flush=True)
                log.warning(msg)
        except Exception as exc:
            msg = f"WARN: Startup TTS check could not query {models_url}: {exc}"
            print(msg, flush=True)
            log.warning(msg)

        # 2. Short sample synthesis with Groq Orpheus
        groq_ok = False
        groq_error: str | None = None
        sample_bytes = 0
        sample_duration: float | None = None
        try:
            wav = await asyncio.wait_for(
                tts.primary.synthesize("Hello, GDArena audio check.", voice=DEFAULT_GROQ_VOICE),
                timeout=cfg.tts_timeout_seconds,
            )
            sample_bytes = len(wav)
            sample_duration = wav_duration_seconds(wav)
            groq_ok = True
            synth_msg = (
                f"OK: Groq TTS test synthesis succeeded (model={tts.primary.model}, "
                f"voice={DEFAULT_GROQ_VOICE}, bytes={sample_bytes}, duration={sample_duration}s)."
            )
            print(synth_msg, flush=True)
            log.info(synth_msg)
        except TTSAccessError as exc:
            groq_error = str(exc)
            tts.trip_primary_cooldown(groq_error)
            fail_msg = f"FAIL: Groq TTS test synthesis failed: {groq_error}"
            print(fail_msg, flush=True)
            log.error(fail_msg)
        except Exception as exc:
            groq_error = str(exc)
            fail_msg = f"FAIL: Groq TTS test synthesis failed: {groq_error}"
            print(fail_msg, flush=True)
            log.error(fail_msg)

        # 3. Also verify Edge TTS fallback voices (and run Edge test if Groq failed)
        edge_res = await _verify_edge_voices(
            tts.fallback,
            list_voices_fn=list_voices_fn,
            run_sample=not groq_ok,
        )
        return {
            "status": "ok" if groq_ok else "fallback_edge",
            "provider": tts.name,
            "model": tts.primary.model,
            "model_available": model_available,
            "groq_ok": groq_ok,
            "groq_error": groq_error,
            "sample_bytes": sample_bytes,
            "sample_duration": sample_duration,
            "edge_fallback": edge_res,
        }

    if isinstance(tts, EdgeTTS):
        return await _verify_edge_voices(tts, list_voices_fn=list_voices_fn, run_sample=True)

    msg = f"Startup TTS check: skipped (provider={tts.name})"
    print(msg, flush=True)
    log.info(msg)
    return {"status": "skipped", "provider": tts.name}


def build_tts(settings: Settings) -> TextToSpeech:
    provider = settings.tts_provider.strip().lower()
    accent = settings.tts_accent_preference.strip().lower()
    voice_map = settings.parsed_tts_voice_map()
    edge = EdgeTTS(accent_preference=accent, voice_overrides=voice_map)

    if provider == "groq":
        if not settings.api_key:
            warn = (
                "WARN: TTS_PROVIDER=groq requested without GROQ_API_KEY/LLM_API_KEY; "
                "falling back to Edge TTS."
            )
            print(warn, flush=True)
            log.warning(warn)
            return edge
        primary = GroqOrpheusTTS(
            api_key=settings.api_key,
            base_url=settings.llm_base_url,
            model=settings.groq_tts_model or DEFAULT_GROQ_TTS_MODEL,
            default_voice=DEFAULT_GROQ_VOICE,
            timeout=settings.tts_timeout_seconds,
        )
        return FallbackTTS(
            primary=primary,
            fallback=edge,
            accent_preference=accent,
            cooldown_seconds=settings.tts_cooldown_seconds,
            voice_overrides=voice_map,
        )
    if provider == "edge":
        return edge
    if provider == "mock":
        return MockTTS()
    return NullTTS()


@lru_cache
def get_tts() -> TextToSpeech:
    return build_tts(get_settings())
