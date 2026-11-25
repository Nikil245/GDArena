"""WebSocket fan-out for a room.

Each connection gets its own outbound queue and writer task, so broadcasting is a
non-blocking, synchronous call (safe to do while holding the room lock) and a slow
client can never stall the room or other clients.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Any

from fastapi import WebSocket

from ..timeutil import iso, utcnow

log = logging.getLogger(__name__)

MAX_PENDING_MESSAGES = 500


def make_event(event_type: str, data: dict[str, Any]) -> str:
    return json.dumps({"type": event_type, "data": data, "ts": iso(utcnow())}, default=str)


class ClientConnection:
    def __init__(self, ws: WebSocket, participant_id: int | None) -> None:
        self.ws = ws
        self.participant_id = participant_id  # None = spectator
        self.closed = False
        self._queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=MAX_PENDING_MESSAGES)
        self._writer: asyncio.Task[None] | None = None

    def start(self) -> None:
        self._writer = asyncio.create_task(self._write_loop())

    async def _write_loop(self) -> None:
        try:
            while True:
                payload = await self._queue.get()
                if payload is None:
                    return
                await self.ws.send_text(payload)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # client went away mid-send
            log.debug("WS writer stopped: %s", exc)
        finally:
            self.closed = True

    def send_raw(self, payload: str) -> bool:
        if self.closed:
            return False
        try:
            self._queue.put_nowait(payload)
        except asyncio.QueueFull:
            log.warning("Dropping slow WS client (participant %s)", self.participant_id)
            self.closed = True
            asyncio.create_task(self._safe_close(code=1013))
            return False
        return True

    def send(self, event_type: str, data: dict[str, Any]) -> bool:
        return self.send_raw(make_event(event_type, data))

    async def _safe_close(self, code: int = 1000) -> None:
        with contextlib.suppress(Exception):
            await self.ws.close(code=code)

    async def close(self) -> None:
        self.closed = True
        if self._writer and not self._writer.done():
            self._writer.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._writer


class RoomHub:
    def __init__(self) -> None:
        self._clients: set[ClientConnection] = set()

    def add(self, conn: ClientConnection) -> None:
        self._clients.add(conn)

    def remove(self, conn: ClientConnection) -> None:
        self._clients.discard(conn)

    @property
    def client_count(self) -> int:
        return len(self._clients)

    def connected_ids(self) -> set[int]:
        return {
            c.participant_id for c in self._clients if c.participant_id is not None and not c.closed
        }

    def broadcast(self, event_type: str, data: dict[str, Any]) -> None:
        payload = make_event(event_type, data)
        for conn in list(self._clients):
            if not conn.send_raw(payload):
                self._clients.discard(conn)

