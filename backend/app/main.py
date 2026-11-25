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
from .services.llm import get_llm

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
    log.info("LLM provider=%s model=%s", llm.provider, llm.model)
    yield
    await registry.shutdown()
    await llm.aclose()


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

