"""WebSocket endpoint: ``/ws/{code}?token=...`` (omit token to connect as a read-only spectator)."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from ..core.errors import GDError
from ..core.hub import make_event
from ..core.registry import registry

log = logging.getLogger(__name__)
router = APIRouter()

MAX_MESSAGE_BYTES = 2_000_000  # leaves room for base64 audio in the voice stage


@router.websocket("/ws/{code}")
async def room_socket(ws: WebSocket, code: str, token: str | None = Query(default=None)) -> None:
    await ws.accept()
    runtime = registry.get(code)
    if runtime is None:
        await ws.send_text(make_event("error", {"code": "room_not_found", "message": "Room not found."}))
        await ws.close(code=4404)
        return
    member = runtime.member_by_token(token) if token else None
    if token and member is None:
        await ws.send_text(make_event("error", {"code": "invalid_token", "message": "Invalid token."}))
        await ws.close(code=4401)
        return

    conn = await runtime.attach(ws, member)
    try:
        while True:
            raw = await ws.receive_text()
            msg: dict | None = None
            try:
                if len(raw) > MAX_MESSAGE_BYTES:
                    raise GDError("message_too_large", "Message too large.")
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    raise GDError("invalid_message", "Messages must be JSON objects.") from None
                if not isinstance(msg, dict) or not isinstance(msg.get("type"), str):
                    raise GDError("invalid_message", "Messages must be JSON objects with a string 'type'.")
                await runtime.handle_message(conn, member, msg)
            except GDError as exc:
                conn.send(
                    "error",
                    exc.as_dict()
                    | {
                        "request_type": msg.get("type") if isinstance(msg, dict) else None,
                        "request_id": msg.get("request_id") if isinstance(msg, dict) else None,
                    },
                )
            except Exception:
                log.exception("Error handling WS message in room %s", runtime.code)
                conn.send("error", {"code": "internal_error", "message": "Internal server error."})
    except WebSocketDisconnect:
        pass
    finally:
        await runtime.detach(conn)

