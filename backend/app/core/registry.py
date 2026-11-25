"""Process-wide registry of live rooms (``code -> RoomRuntime``), backed by SQLite."""

from __future__ import annotations

import logging
import secrets

from sqlmodel import select

from ..db import new_session
from ..models import Participant, Room, RoomStatus, ScoreAdjustment, Turn
from ..schemas import CreateRoomRequest
from ..services.topics import random_topic
from ..timeutil import utcnow
from .runtime import RoomRuntime

log = logging.getLogger(__name__)

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I
CODE_LENGTH = 6
MAX_IDLE_ROOMS_IN_MEMORY = 200


def generate_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


class RoomRegistry:
    def __init__(self) -> None:
        self._rooms: dict[str, RoomRuntime] = {}

    def create_room(self, req: CreateRoomRequest) -> RoomRuntime:
        if req.topic:
            topic, category, source = req.topic, None, "user"
        else:
            picked = random_topic(req.topic_category)
            topic, category, source = picked.title, picked.category, "bank"

        with new_session() as s:
            for _ in range(50):
                code = generate_code()
                exists = code in self._rooms or s.exec(select(Room).where(Room.code == code)).first()
                if not exists:
                    break
            else:  # pragma: no cover - 32^6 codes
                raise RuntimeError("could not allocate a room code")
            room = Room(
                code=code,
                topic=topic,
                topic_category=category,
                topic_source=source,
                max_participants=req.max_participants,
                duration_seconds=req.duration_seconds,
                turn_limit_seconds=req.turn_limit_seconds,
                fill_with_ai=req.fill_with_ai,
            )
            s.add(room)
            s.commit()
            s.refresh(room)

        runtime = RoomRuntime(room, [], [], [])
        self._evict_idle()
        self._rooms[code] = runtime
        log.info("Room %s created (topic=%r, source=%s)", code, topic, source)
        return runtime

    def get(self, code: str) -> RoomRuntime | None:
        code = code.strip().upper()
        runtime = self._rooms.get(code)
        if runtime is not None:
            return runtime
        with new_session() as s:
            room = s.exec(select(Room).where(Room.code == code)).first()
            if room is None:
                return None
            participants = list(s.exec(select(Participant).where(Participant.room_id == room.id).order_by(Participant.id)))
            turns = list(s.exec(select(Turn).where(Turn.room_id == room.id).order_by(Turn.seq)))
            adjustments = list(s.exec(select(ScoreAdjustment).where(ScoreAdjustment.room_id == room.id)))
        runtime = RoomRuntime(room, participants, turns, adjustments)
        self._evict_idle()
        self._rooms[code] = runtime
        return runtime

    def recover_stale_rooms(self) -> None:
        """Rooms left 'running' by a previous process can't resume (timer/turn state is in memory)."""
        with new_session() as s:
            stale = list(s.exec(select(Room).where(Room.status == RoomStatus.RUNNING)))
            for room in stale:
                room.status = RoomStatus.FINISHED
                room.ended_at = utcnow()
                room.end_reason = "server_restart"
                s.add(room)
            s.commit()
        if stale:
            log.warning("Marked %d interrupted room(s) as finished", len(stale))

    def _evict_idle(self) -> None:
        if len(self._rooms) < MAX_IDLE_ROOMS_IN_MEMORY:
            return
        for code in [c for c, r in self._rooms.items() if r.idle]:
            del self._rooms[code]

    async def shutdown(self) -> None:
        for runtime in list(self._rooms.values()):
            await runtime.shutdown()


registry = RoomRegistry()

