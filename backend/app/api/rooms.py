"""REST endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, Form, Query, UploadFile
from fastapi.responses import JSONResponse

from ..core.errors import GDError
from ..core.registry import registry
from ..core.runtime import RoomRuntime
from ..models import RoomStatus
from ..schemas import CreateRoomRequest, JoinRoomRequest, TopicCategory
from ..services import topics
from ..services.llm import get_llm
from ..services.personas import ALL_PERSONAS
from ..services.stt import STTError, VoiceNotSupportedError, get_stt

router = APIRouter()

MAX_AUDIO_BYTES = 20 * 1024 * 1024


def _room_or_404(code: str) -> RoomRuntime:
    runtime = registry.get(code)
    if runtime is None:
        raise GDError("room_not_found", f"No room with code {code.upper()!r}.", 404)
    return runtime


@router.get("/health", tags=["meta"])
async def health() -> dict[str, Any]:
    llm = get_llm()
    stt = get_stt()
    return {
        "status": "ok",
        "llm_provider": llm.provider,
        "llm_model": llm.model,
        "stt_provider": stt.name,
        "stt_model": getattr(stt, "model", None),
    }


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

