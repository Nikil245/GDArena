"""REST endpoints."""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, Body, File, Form, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field

from ..config import get_settings
from ..core.errors import GDError
from ..core.registry import registry
from ..core.runtime import RoomRuntime
from ..models import RoomStatus
from ..schemas import CreateRoomRequest, JoinRoomRequest, TopicCategory
from ..services import topics
from ..services.llm import get_llm
from ..services.personas import ALL_PERSONAS, find_persona
from ..services.service_status import get_service_status
from ..services.stt import STTError, STTRateLimitError, VoiceNotSupportedError, get_stt
from ..services.tts import (
    TTSError,
    get_tts,
    get_turn_audio_path,
)

log = logging.getLogger(__name__)
router = APIRouter()

MAX_AUDIO_BYTES = 20 * 1024 * 1024


class TtsTestRequest(BaseModel):
    persona: str | None = Field(default=None, max_length=60)
    provider: Literal["groq", "edge"] | None = Field(default=None)
    voice: str | None = Field(default=None, max_length=100)
    text: str | None = Field(default=None, max_length=300)
    rate: str | None = Field(default=None, max_length=16)


def _room_or_404(code: str) -> RoomRuntime:
    runtime = registry.get(code)
    if runtime is None:
        raise GDError("room_not_found", f"No room with code {code.upper()!r}.", 404)
    return runtime


@router.get("/health", tags=["meta"])
async def health() -> dict[str, Any]:
    llm = get_llm()
    stt = get_stt()
    tts = get_tts()
    settings = get_settings()
    return {
        "status": "ok",
        "llm_provider": llm.provider,
        "llm_model": llm.model,
        "stt_provider": stt.name,
        "stt_model": getattr(stt, "model", None),
        "tts_provider": tts.name,
        "tts_model": getattr(tts, "model", None),
        "tts_accent_preference": settings.tts_accent_preference,
    }


@router.get("/status", tags=["meta"])
async def service_status() -> dict[str, Any]:
    """Cheap, secret-free in-memory status for LLM and STT services."""
    return get_service_status().public_status()


@router.get("/audio/{room_code}/{turn_id}.{ext}", tags=["voice"])
async def get_turn_audio(room_code: str, turn_id: int, ext: Literal["wav", "mp3"]) -> FileResponse:
    path = get_turn_audio_path(room_code, turn_id)
    if path is None or path.suffix.lstrip(".").lower() != ext:
        raise GDError("audio_not_found", "Audio clip not found.", 404)
    media_type = "audio/wav" if ext == "wav" else "audio/mpeg"
    return FileResponse(path, media_type=media_type, headers={"Cache-Control": "no-store"})


@router.post("/tts/test", tags=["voice"])
async def test_tts(req: TtsTestRequest | None = Body(default=None)) -> Response:
    tts = get_tts()
    persona_obj = None
    if req and req.persona:
        persona_obj = find_persona(req.persona)
        if persona_obj is None:
            raise GDError("unknown_persona", f"Unknown persona {req.persona!r}.", 400)

    voice = req.voice if req and req.voice else None
    rate = req.rate if req and req.rate else None
    provider = req.provider if req and req.provider else None
    default_text = (
        f"Hi, I'm {persona_obj.name}. Server-side AI voice playback is working in GDArena."
        if persona_obj
        else "Hello! Server-side AI voice playback is working in GDArena."
    )
    text = (req.text if req and req.text else None) or default_text

    try:
        synth = await tts.synthesize_for_persona(
            text,
            persona=persona_obj,
            voice=voice,
            rate=rate,
            provider_override=provider,
        )
    except TTSError as exc:
        log.error("POST /tts/test failed: %s", exc, exc_info=True)
        raise GDError("tts_error", str(exc), 502) from exc

    if synth is None or not synth.data:
        raise GDError("tts_disabled", "Server-side TTS is disabled (TTS_PROVIDER=none).", 400)

    headers = {
        "X-TTS-Provider": synth.provider,
        "X-TTS-Voice": synth.voice,
        "X-Audio-Format": synth.ext,
        "Cache-Control": "no-store",
    }
    if synth.duration_seconds is not None:
        headers["X-Audio-Duration"] = str(synth.duration_seconds)
    return Response(content=synth.data, media_type=synth.media_type, headers=headers)


@router.post("/stt", tags=["voice"])
async def transcribe_speech(
    file: UploadFile = File(...),
    language: str = Form(default="en"),
) -> dict[str, Any]:
    data = await file.read()
    if not data:
        raise GDError("empty_audio", "Audio recording is empty.", 400)
    if len(data) > MAX_AUDIO_BYTES:
        raise GDError("audio_too_large", "Audio recording exceeds the 20 MB limit.", 413)
    stt = get_stt()
    try:
        result = await stt.transcribe(data, mime_type=file.content_type, language=language)
    except STTRateLimitError as exc:
        return JSONResponse(
            status_code=429,
            content={
                "code": "stt_rate_limited",
                "retry_after_seconds": exc.retry_after_seconds,
                "message": str(exc),
            },
        )
    except VoiceNotSupportedError as exc:
        raise GDError("voice_not_supported", str(exc), 400) from exc
    except STTError as exc:
        raise GDError("stt_error", str(exc), 400) from exc
    return {
        "text": result.text,
        "source": result.source,
        "language": result.language,
        "model": getattr(stt, "model", None),
    }


@router.get("/topics", tags=["meta"])
async def list_topics(category: TopicCategory | None = Query(default=None)) -> dict[str, Any]:
    return {"categories": topics.categories(), "topics": [t.public() for t in topics.all_topics(category)]}


@router.get("/personas", tags=["meta"])
async def list_personas() -> dict[str, Any]:
    return {"personas": [p.public() | {"name": p.name} for p in ALL_PERSONAS.values()]}


@router.post("/rooms", status_code=201, tags=["rooms"])
async def create_room(req: CreateRoomRequest) -> dict[str, Any]:
    return registry.create_room(req).room_public()


@router.get("/rooms/{code}", tags=["rooms"])
async def get_room(code: str) -> dict[str, Any]:
    return _room_or_404(code).snapshot()


@router.post("/rooms/{code}/join", status_code=201, tags=["rooms"])
async def join_room(code: str, req: JoinRoomRequest) -> dict[str, Any]:
    runtime = _room_or_404(code)
    member = await runtime.join(req.name, req.role)
    return {
        "participant": runtime.member_public(member),
        "token": member.token,
        "ws_url": f"/ws/{runtime.code}?token={member.token}",
        "room": runtime.room_public(),
    }


@router.get("/rooms/{code}/transcript", tags=["rooms"])
async def get_transcript(code: str) -> dict[str, Any]:
    runtime = _room_or_404(code)
    return {"transcript": [e.public() for e in runtime.entries]}


@router.get("/rooms/{code}/leaderboard", tags=["rooms"])
async def get_leaderboard(code: str) -> dict[str, Any]:
    return {"leaderboard": _room_or_404(code).leaderboard()}


@router.get("/rooms/{code}/report", tags=["rooms"], responses={202: {"description": "Report is being generated"}})
async def get_report(code: str) -> Any:
    runtime = _room_or_404(code)
    if runtime.report is not None:
        return runtime.report
    if runtime.status != RoomStatus.FINISHED:
        raise GDError("not_finished", "The report is available once the GD has finished.", 409)
    if runtime.report_status == "generating":
        return JSONResponse(status_code=202, content={"status": "generating"})
    raise GDError("report_unavailable", "The report could not be generated for this room.", 404)

