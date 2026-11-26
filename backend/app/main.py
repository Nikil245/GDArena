"""FastAPI entry point: ``uvicorn app.main:app --reload`` (run from ``backend/``)."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .api import rooms, ws
from .config import get_settings
from .core.errors import GDError
from .core.registry import registry
from .db import init_db
from .services.llm import get_llm, verify_provider_models
from .services.stt import get_stt
from .services.tts import get_tts, verify_tts_voices

settings = get_settings()
logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger("gd_arena")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    init_db()
    registry.recover_stale_rooms()
    llm = get_llm()
    stt = get_stt()
    tts = get_tts()
    await verify_provider_models(settings, llm, stt)
    await verify_tts_voices(tts, settings)
    log.info(
        "LLM provider=%s model=%s | STT provider=%s model=%s | TTS provider=%s model=%s accent=%s",
        llm.provider,
        llm.model,
        stt.name,
        getattr(stt, "model", None),
        tts.name,
        getattr(tts, "model", None),
        settings.tts_accent_preference,
    )
    yield
    await registry.shutdown()
    await llm.aclose()
    await stt.aclose()
    await tts.aclose()


app = FastAPI(title="GD Arena API", version=__version__, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=settings.cors_origin_list != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(GDError)
async def gd_error_handler(_: Request, exc: GDError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": exc.as_dict()})


app.include_router(rooms.router)
app.include_router(ws.router)

