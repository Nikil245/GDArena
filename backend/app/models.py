"""Persistent tables (SQLite via SQLModel).

Live room state (timer, queue, current speaker) lives in memory in ``RoomRuntime``;
everything that must survive is written here as it happens.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel

from .timeutil import utcnow


class RoomStatus(str, Enum):
    LOBBY = "lobby"
    RUNNING = "running"
    FINISHED = "finished"


class Role(str, Enum):
    PLAYER = "player"
    MODERATOR = "moderator"


class TurnStatus(str, Enum):
    COMPLETED = "completed"
    SKIPPED = "skipped"


class Room(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True, max_length=12)
    topic: str
    topic_category: str | None = None
    topic_source: str = "user"  # "user" | "bank"
    max_participants: int
    duration_seconds: int = 600
    turn_limit_seconds: int | None = None
    fill_with_ai: bool = True
    status: RoomStatus = Field(default=RoomStatus.LOBBY)
    end_reason: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    started_at: datetime | None = None
    ended_at: datetime | None = None
    report: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))


class Participant(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    room_id: int = Field(foreign_key="room.id", index=True)
    name: str
    role: Role = Field(default=Role.PLAYER)
    is_ai: bool = False
    persona_key: str | None = None
    token: str = Field(index=True, unique=True)
    joined_at: datetime = Field(default_factory=utcnow)


class Turn(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    room_id: int = Field(foreign_key="room.id", index=True)
    participant_id: int = Field(foreign_key="participant.id", index=True)
    seq: int
    status: TurnStatus = Field(default=TurnStatus.COMPLETED)
    text: str | None = None
    source: str = "text"  # "text" | "voice" | "ai"
    skip_reason: str | None = None
    started_at: datetime = Field(default_factory=utcnow)
    ended_at: datetime | None = None
    relevance: int | None = None
    clarity: int | None = None
    content: int | None = None
    teamwork: int | None = None
    comment: str | None = None
    turn_score: float | None = None


class ScoreAdjustment(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    room_id: int = Field(foreign_key="room.id", index=True)
    participant_id: int = Field(foreign_key="participant.id", index=True)
    delta: float
    reason: str | None = None
    by_participant_id: int | None = Field(default=None, foreign_key="participant.id")
    created_at: datetime = Field(default_factory=utcnow)

