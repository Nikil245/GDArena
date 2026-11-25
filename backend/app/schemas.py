"""Request bodies for the REST API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .models import Role

TopicCategory = Literal["current_affairs", "business", "social", "abstract"]


class CreateRoomRequest(BaseModel):
    topic: str | None = Field(
        default=None,
        max_length=300,
        description="GD topic. null/empty -> the moderator picks a random topic from the bank.",
    )
    topic_category: TopicCategory | None = Field(
        default=None, description="Restrict the random pick to a category (only used when topic is null)."
    )
    max_participants: int = Field(default=5, ge=2, le=10, description="Seats (players, human + AI).")
    duration_seconds: int = Field(default=600, ge=30, le=3600)
    turn_limit_seconds: int | None = Field(default=None, ge=10, le=600, description="null = no per-turn limit.")
    fill_with_ai: bool = Field(default=True, description="Fill empty seats with AI participants on start.")

    @field_validator("topic")
    @classmethod
    def _clean_topic(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = " ".join(v.split())
        return v or None


class JoinRoomRequest(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    role: Role = Role.PLAYER

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("name must not be blank")
        return v

