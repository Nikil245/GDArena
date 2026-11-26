"""Live, in-memory runtime for one GD room.

Concurrency model: everything runs on the single asyncio event loop. Every state mutation
happens while holding ``self.lock``; LLM calls happen *outside* the lock. Broadcasting is
non-blocking (see ``hub.py``), so it is safe inside the lock. State that must survive is
persisted to SQLite as it changes.

State machine: lobby -> running -> finished.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import math
import random
import secrets
import time
from collections.abc import Coroutine
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from fastapi import WebSocket

from ..config import Settings, get_settings
from ..db import new_session
from ..models import Participant, Role, Room, RoomStatus, ScoreAdjustment, Turn, TurnStatus
from ..services import ai_agent, scoring
from ..services.llm import LLMClient, get_llm
from ..services.personas import Persona, assign_personas, get_persona
from ..services.stt import SpeechInput, SpeechToText, STTError, VoiceNotSupportedError, get_stt, resolve_speech
from ..services.tts import TextToSpeech, cleanup_room_audio, get_tts, save_turn_audio
from ..timeutil import iso, utcnow
from .errors import GDError
from .hub import ClientConnection, RoomHub

log = logging.getLogger(__name__)

REPORT_SCORING_WAIT_SECONDS = 60.0


@dataclass
class Member:
    id: int
    name: str
    role: Role
    is_ai: bool
    persona: Persona | None
    token: str
    joined_at: datetime

    @property
    def is_player(self) -> bool:
        return self.role == Role.PLAYER


@dataclass
class Entry:
    """A completed (spoken) turn in the transcript."""

    turn_id: int
    seq: int
    participant_id: int
    name: str
    is_ai: bool
    text: str
    source: str
    started_at: datetime
    ended_at: datetime
    audio_url: str | None = None
    audio_duration_seconds: float | None = None
    scores: dict[str, int] | None = None
    comment: str | None = None
    turn_score: float | None = None

    def public(self) -> dict[str, Any]:
        return {
            "turn_id": self.turn_id,
            "seq": self.seq,
            "participant_id": self.participant_id,
            "name": self.name,
            "is_ai": self.is_ai,
            "text": self.text,
            "source": self.source,
            "audio_url": self.audio_url,
            "audio_duration_seconds": self.audio_duration_seconds,
            "started_at": iso(self.started_at),
            "ended_at": iso(self.ended_at),
            "scores": self.scores,
            "comment": self.comment,
            "turn_score": self.turn_score,
        }

    def score_public(self) -> dict[str, Any]:
        return {
            "turn_id": self.turn_id,
            "seq": self.seq,
            "participant_id": self.participant_id,
            "name": self.name,
            "scores": self.scores,
            "comment": self.comment,
            "turn_score": self.turn_score,
        }


@dataclass
class Adjustment:
    participant_id: int
    delta: float
    reason: str | None
    by_participant_id: int | None
    created_at: datetime


@dataclass
class PrefetchState:
    participant_id: int
    history_len: int
    task: asyncio.Task[None]
    text: str | None = None
    tts_text: str | None = None
    audio_bytes: bytes | None = None
    audio_ext: str | None = None
    audio_duration: float | None = None
    audio_provider: str | None = None
    llm_ms: float = 0.0
    tts_ms: float = 0.0
    ready: bool = False
    failed: bool = False


@dataclass
class ActiveTurn:
    seq: int
    participant_id: int
    started_mono: float
    started_at: datetime
    deadline_mono: float | None
    deadline_at: datetime | None
    phase: str  # "thinking" (AI generating) | "speaking"
    task: asyncio.Task[None] | None = None
    entry_recorded: bool = False
    turn_id: int | None = None
    chosen_mono: float = field(default_factory=time.monotonic)
    playback_done: asyncio.Event = field(default_factory=asyncio.Event)
    playback_ended_mono: float | None = None


class RoomRuntime:
    def __init__(
        self,
        room: Room,
        participants: list[Participant],
        turns: list[Turn],
        adjustments: list[ScoreAdjustment],
        *,
        settings: Settings | None = None,
        llm: LLMClient | None = None,
        stt: SpeechToText | None = None,
        tts: TextToSpeech | None = None,
    ) -> None:
        assert room.id is not None
        self.settings = settings or get_settings()
        self.llm = llm or get_llm()
        self.stt = stt or get_stt()
        self.tts = tts or get_tts()

        self.room_id: int = room.id
        self.code = room.code
        self.topic = room.topic
        self.topic_category = room.topic_category
        self.topic_source = room.topic_source
        self.max_participants = room.max_participants
        self.duration_seconds = room.duration_seconds
        self.turn_limit_seconds = room.turn_limit_seconds
        self.fill_with_ai = room.fill_with_ai
        self.status = RoomStatus(room.status)
        self.end_reason = room.end_reason
        self.created_at = room.created_at
        self.started_at = room.started_at
        self.ended_at = room.ended_at
        self.ends_at = (
            room.started_at + timedelta(seconds=room.duration_seconds) if room.started_at else None
        )
        self.report: dict[str, Any] | None = room.report
        self.report_status: str | None = (
            "ready" if room.report else ("failed" if self.status == RoomStatus.FINISHED else None)
        )

        self.members: dict[int, Member] = {}
        for p in participants:
            assert p.id is not None
            self.members[p.id] = Member(
                id=p.id,
                name=p.name,
                role=Role(p.role),
                is_ai=p.is_ai,
                persona=get_persona(p.persona_key),
                token=p.token,
                joined_at=p.joined_at,
            )
        self.entries: list[Entry] = []
        for t in turns:
            if t.status != TurnStatus.COMPLETED or not t.text or t.participant_id not in self.members:
                continue
            m = self.members[t.participant_id]
            has_scores = t.turn_score is not None
            self.entries.append(
                Entry(
                    turn_id=t.id or 0,
                    seq=t.seq,
                    participant_id=m.id,
                    name=m.name,
                    is_ai=m.is_ai,
                    text=t.text,
                    source=t.source,
                    started_at=t.started_at,
                    ended_at=t.ended_at or t.started_at,
                    scores=(
                        {"relevance": t.relevance, "clarity": t.clarity, "content": t.content, "teamwork": t.teamwork}
                        if has_scores
                        else None
                    ),
                    comment=t.comment,
                    turn_score=t.turn_score,
                )
            )
        self.adjustments: list[Adjustment] = [
            Adjustment(a.participant_id, a.delta, a.reason, a.by_participant_id, a.created_at) for a in adjustments
        ]
        self.turn_seq = max((t.seq for t in turns), default=0)

        self.queue: list[int] = []
        self.active: ActiveTurn | None = None
        self.hub = RoomHub()
        self.lock = asyncio.Lock()

        self._started_mono: float | None = None
        self._ends_mono: float | None = None
        self._floor_free_since = time.monotonic()
        self._tick_task: asyncio.Task[None] | None = None
        self._gap_task: asyncio.Task[None] | None = None
        self._ai_gap_until_mono: float = 0.0
        self._last_audio_ended_mono: float | None = None
        self._prefetch: PrefetchState | None = None
        self._tasks: set[asyncio.Task[Any]] = set()
        self._scoring_tasks: set[asyncio.Task[Any]] = set()
        self._rng = random.Random()

    # ==================================================================================
    # Read models
    # ==================================================================================

    def players(self) -> list[Member]:
        return [m for m in self.members.values() if m.is_player]

    def moderator(self) -> Member | None:
        return next((m for m in self.members.values() if m.role == Role.MODERATOR), None)

    def can_moderate(self, m: Member) -> bool:
        """The moderator controls the GD. With no moderator in the room, the first human player (host) does."""
        if m.role == Role.MODERATOR:
            return True
        if self.moderator() is not None or m.is_ai:
            return False
        host = next((p for p in self.members.values() if p.is_player and not p.is_ai), None)
        return host is not None and host.id == m.id

    def member_by_token(self, token: str) -> Member | None:
        return next((m for m in self.members.values() if not m.is_ai and secrets.compare_digest(m.token, token)), None)

    def member_public(self, m: Member) -> dict[str, Any]:
        return {
            "id": m.id,
            "name": m.name,
            "role": m.role.value,
            "is_ai": m.is_ai,
            "persona": m.persona.public() if m.persona else None,
            "connected": m.is_ai or m.id in self.hub.connected_ids(),
            "hand_raised": m.id in self.queue,
            "is_speaking": self.active is not None and self.active.participant_id == m.id,
            "can_moderate": self.can_moderate(m),
        }

    def participants_public(self) -> list[dict[str, Any]]:
        return [self.member_public(m) for m in self.members.values()]

    def queue_public(self) -> list[dict[str, Any]]:
        return [
            {"participant_id": pid, "name": self.members[pid].name, "is_ai": self.members[pid].is_ai}
            for pid in self.queue
            if pid in self.members
        ]

    def speaker_public(self) -> dict[str, Any] | None:
        a = self.active
        if a is None:
            return None
        m = self.members[a.participant_id]
        return {
            "participant_id": m.id,
            "name": m.name,
            "is_ai": m.is_ai,
            "seq": a.seq,
            "phase": a.phase,
            "started_at": iso(a.started_at),
            "deadline_at": iso(a.deadline_at),
        }

    def timer_public(self, now: float | None = None) -> dict[str, Any]:
        now = time.monotonic() if now is None else now
        if self.status == RoomStatus.RUNNING and self._ends_mono is not None and self._started_mono is not None:
            remaining = max(0, round(self._ends_mono - now))
            elapsed = min(self.duration_seconds, max(0, round(now - self._started_mono)))
        elif self.status == RoomStatus.FINISHED and self.started_at and self.ended_at:
            elapsed = min(self.duration_seconds, max(0, round((self.ended_at - self.started_at).total_seconds())))
            remaining = max(0, self.duration_seconds - elapsed)
        else:
            remaining, elapsed = self.duration_seconds, 0
        turn_remaining = None
        if self.active and self.active.deadline_mono is not None:
            turn_remaining = max(0, round(self.active.deadline_mono - now))
        return {
            "status": self.status.value,
            "duration_seconds": self.duration_seconds,
            "remaining_seconds": remaining,
            "elapsed_seconds": elapsed,
            "ends_at": iso(self.ends_at),
            "turn_limit_seconds": self.turn_limit_seconds,
            "turn_remaining_seconds": turn_remaining,
        }

    def leaderboard(self) -> list[dict[str, Any]]:
        return scoring.compute_leaderboard(self.players(), self.entries, self.adjustments)

    def room_public(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "topic": self.topic,
            "topic_category": self.topic_category,
            "topic_source": self.topic_source,
            "status": self.status.value,
            "max_participants": self.max_participants,
            "seats_taken": len(self.players()),
            "duration_seconds": self.duration_seconds,
            "turn_limit_seconds": self.turn_limit_seconds,
            "fill_with_ai": self.fill_with_ai,
            "has_moderator": self.moderator() is not None,
            "created_at": iso(self.created_at),
            "started_at": iso(self.started_at),
            "ends_at": iso(self.ends_at),
            "ended_at": iso(self.ended_at),
            "end_reason": self.end_reason,
        }

    def snapshot(self) -> dict[str, Any]:
        return {
            "room": self.room_public(),
            "participants": self.participants_public(),
            "timer": self.timer_public(),
            "current_speaker": self.speaker_public(),
            "queue": self.queue_public(),
            "transcript": [e.public() for e in self.entries],
            "leaderboard": self.leaderboard(),
            "report_status": self.report_status,
            "report": self.report,
        }

    # ==================================================================================
    # Connections
    # ==================================================================================

    async def attach(self, ws: WebSocket, member: Member | None) -> ClientConnection:
        conn = ClientConnection(ws, member.id if member else None)
        conn.start()
        async with self.lock:
            was_connected = member is not None and member.id in self.hub.connected_ids()
            self.hub.add(conn)
            conn.send(
                "welcome",
                {"you": self.member_public(member) if member else None, "state": self.snapshot()},
            )
            if member is not None and not was_connected:
                self._broadcast_participants()
        return conn

    async def detach(self, conn: ClientConnection) -> None:
        self.hub.remove(conn)
        await conn.close()
        pid = conn.participant_id
        if pid is None:
            return
        async with self.lock:
            if pid in self.hub.connected_ids():
                return  # still connected from another tab
            if self.status == RoomStatus.RUNNING:
                if self.active and self.active.participant_id == pid:
                    self._skip_active("disconnected")
                    self._advance()
                if pid in self.queue:
                    self.queue.remove(pid)
                    self._broadcast_queue()
                    self._sync_prefetch("detach")
            self._broadcast_participants()

    async def handle_message(self, conn: ClientConnection, member: Member | None, msg: dict[str, Any]) -> None:
        mtype = msg.get("type")
        if mtype == "ping":
            conn.send("pong", {"request_id": msg.get("request_id")})
            return
        if mtype == "get_state":
            conn.send("state", self.snapshot())
            return
        if member is None:
            raise GDError("spectator_read_only", "Spectators cannot send commands; join the room first.", 403)

        if mtype == "start_gd":
            await self.start(member)
        elif mtype == "end_gd":
            await self.end("moderator", by=member)
        elif mtype == "raise_hand":
            await self.raise_hand(member)
        elif mtype == "lower_hand":
            await self.lower_hand(member, _opt_int(msg.get("participant_id")))
        elif mtype == "submit_turn":
            await self.submit_turn(member, _speech_input(msg))
        elif mtype == "yield_turn":
            await self.yield_turn(member)
        elif mtype == "grant_turn":
            await self.grant_turn(member, _req_int(msg, "participant_id"))
        elif mtype == "skip_speaker":
            await self.skip_speaker(member)
        elif mtype == "adjust_score":
            await self.adjust_score(member, _req_int(msg, "participant_id"), msg.get("delta"), msg.get("reason"))
        elif mtype == "playback_ended":
            await self.report_playback_ended(_opt_int(msg.get("turn_id")))
        else:
            raise GDError("unknown_type", f"Unknown message type {mtype!r}.")

    # ==================================================================================
    # Commands
    # ==================================================================================

    async def join(self, name: str, role: Role) -> Member:
        async with self.lock:
            if self.status == RoomStatus.FINISHED:
                raise GDError("room_finished", "This GD has already finished.", 409)
            if any(m.name.lower() == name.lower() for m in self.members.values()):
                raise GDError("name_taken", f"The name {name!r} is already taken in this room.", 409)
            if role == Role.MODERATOR:
                if self.moderator() is not None:
                    raise GDError("moderator_taken", "This room already has a moderator.", 409)
            else:
                if self.status != RoomStatus.LOBBY:
                    raise GDError("already_started", "Players can only join while the room is in the lobby.", 409)
                if len(self.players()) >= self.max_participants:
                    raise GDError("room_full", "All seats are taken.", 409)
            member = self._create_member(name=name, role=role, is_ai=False, persona=None)
            self._broadcast_participants()
            if role == Role.PLAYER:
                self._broadcast_leaderboard()
            return member

    async def start(self, by: Member) -> None:
        async with self.lock:
            self._require_moderator(by)
            if self.status != RoomStatus.LOBBY:
                raise GDError("invalid_state", f"Cannot start: the GD is {self.status.value}.", 409)
            free = self.max_participants - len(self.players())
            if len(self.players()) + (free if self.fill_with_ai else 0) < 2:
                raise GDError("not_enough_participants", "At least 2 participants are needed to start.", 409)
            if self.fill_with_ai and free > 0:
                taken = {m.name for m in self.members.values()}
                for persona, name in assign_personas(free, taken, self._rng):
                    self._create_member(name=name, role=Role.PLAYER, is_ai=True, persona=persona)

            now_mono = time.monotonic()
            self.status = RoomStatus.RUNNING
            self.started_at = utcnow()
            self.ends_at = self.started_at + timedelta(seconds=self.duration_seconds)
            self._started_mono = now_mono
            self._ends_mono = now_mono + self.duration_seconds
            self._floor_free_since = now_mono
            self._persist_room(status=self.status, started_at=self.started_at)

            self._broadcast_participants()
            self._broadcast_leaderboard()
            self.hub.broadcast(
                "gd_started",
                {
                    "topic": self.topic,
                    "started_at": iso(self.started_at),
                    "ends_at": iso(self.ends_at),
                    "duration_seconds": self.duration_seconds,
                    "turn_limit_seconds": self.turn_limit_seconds,
                    "participants": self.participants_public(),
                    "leaderboard": self.leaderboard(),
                },
            )
            self._tick_task = self._spawn(self._tick_loop())
            log.info("Room %s started: %d players, topic=%r", self.code, len(self.players()), self.topic)

    async def end(self, reason: str, by: Member | None = None) -> None:
        async with self.lock:
            if by is not None:
                self._require_moderator(by)
            if self.status != RoomStatus.RUNNING:
                if by is not None:
                    raise GDError("invalid_state", f"Cannot end: the GD is {self.status.value}.", 409)
                return
            self.status = RoomStatus.FINISHED
            self.ended_at = utcnow()
            self.end_reason = reason
            self.report_status = "generating"
            had_speaker = self.active is not None
            if self.active:
                self._cancel_turn_task(self.active)
                self.active = None
            self._cancel_gap_task()
            self._cancel_prefetch("room_ended")
            self.queue.clear()
            self._persist_room(status=self.status, ended_at=self.ended_at, end_reason=reason)

            if had_speaker:
                self.hub.broadcast("speaker_changed", {"speaker": None})
            self._broadcast_queue()
            self.hub.broadcast("timer", self.timer_public())
            self.hub.broadcast(
                "gd_ended",
                {
                    "reason": reason,
                    "ended_at": iso(self.ended_at),
                    "elapsed_seconds": self.timer_public()["elapsed_seconds"],
                    "leaderboard": self.leaderboard(),
                },
            )
        tick = self._tick_task
        if tick is not None and tick is not asyncio.current_task() and not tick.done():
            tick.cancel()
        cleanup_room_audio(self.code)
        self._spawn(self._build_report())
        log.info("Room %s ended (%s)", self.code, reason)

    async def raise_hand(self, m: Member) -> None:
        async with self.lock:
            self._require_running()
            self._require_player(m)
            if m.id in self.queue:
                raise GDError("already_queued", "Your hand is already raised.", 409)
            if self.active and self.active.participant_id == m.id:
                raise GDError("already_speaking", "You already have the floor.", 409)
            self._enqueue(m)
            self._broadcast_queue()
            self._sync_prefetch("raise_hand")
            if not m.is_ai and self.active is None:
                self._cancel_gap_task()
            self._advance()

    async def lower_hand(self, m: Member, participant_id: int | None = None) -> None:
        async with self.lock:
            target = m.id
            if participant_id is not None and participant_id != m.id:
                self._require_moderator(m)  # moderators may clear anyone's hand
                target = participant_id
            if target in self.queue:
                self.queue.remove(target)
                self._broadcast_queue()
                self._sync_prefetch("lower_hand")

    async def report_playback_ended(self, turn_id: int | None) -> None:
        async with self.lock:
            a = self.active
            if (
                a is not None
                and a.entry_recorded
                and (turn_id is None or a.turn_id == turn_id)
                and not a.playback_done.is_set()
            ):
                a.playback_ended_mono = time.monotonic()
                a.playback_done.set()
                log.info("[TIMING] room=%s turn_id=%s client reported playback_ended", self.code, a.turn_id)

    async def submit_turn(self, m: Member, inp: SpeechInput) -> None:
        self._require_player(m)
        if self.active is None or self.active.participant_id != m.id:
            raise GDError("not_your_turn", "You don't have the floor. Raise your hand first.", 409)
        try:
            transcription = await resolve_speech(inp, self.stt)
        except VoiceNotSupportedError as exc:
            raise GDError("voice_not_supported", str(exc), 400) from exc
        except STTError as exc:
            raise GDError("invalid_turn", str(exc), 400) from exc
        text = " ".join(transcription.text.split())[: self.settings.max_human_turn_chars]
        if not text:
            raise GDError("empty_turn", "Turn text must not be empty.", 400)

        async with self.lock:
            self._require_running()
            a = self.active
            if a is None or a.participant_id != m.id:
                raise GDError("not_your_turn", "Your turn has already ended.", 409)
            self._record_entry(m, a, text, source=transcription.source)
            self._last_audio_ended_mono = time.monotonic()
            self._cancel_gap_task()
            self._cancel_prefetch("human_submit")
            self._release_floor()
            self._advance()

    async def yield_turn(self, m: Member) -> None:
        async with self.lock:
            self._require_running()
            if self.active is None or self.active.participant_id != m.id:
                raise GDError("not_your_turn", "You don't have the floor.", 409)
            self._cancel_prefetch("yield_turn")
            self._skip_active("yielded")
            self._advance()

    async def grant_turn(self, by: Member, participant_id: int) -> None:
        async with self.lock:
            self._require_moderator(by)
            self._require_running()
            target = self.members.get(participant_id)
            if target is None or not target.is_player:
                raise GDError("not_found", "No such player in this room.", 404)
            if self.active is not None:
                raise GDError("floor_busy", "Someone is speaking. Use skip_speaker first.", 409)
            self._cancel_gap_task()
            self._cancel_prefetch("grant_turn")
            if participant_id in self.queue:
                self.queue.remove(participant_id)
                self._broadcast_queue()
            self._begin_turn(target)

    async def skip_speaker(self, by: Member) -> None:
        async with self.lock:
            self._require_moderator(by)
            self._require_running()
            if self.active is None:
                raise GDError("no_speaker", "Nobody is speaking.", 409)
            self._cancel_prefetch("skip_speaker")
            self._skip_active("moderator_skip")
            self._advance()

    async def adjust_score(self, by: Member, participant_id: int, delta: Any, reason: Any = None) -> None:
        try:
            value = round(float(delta), 2)
        except (TypeError, ValueError):
            raise GDError("invalid_message", "'delta' must be a number.") from None
        if not math.isfinite(value) or value == 0 or abs(value) > 10:
            raise GDError("invalid_message", "'delta' must be non-zero and between -10 and 10.")
        reason_txt = " ".join(str(reason).split())[:200] if reason else None
        async with self.lock:
            self._require_moderator(by)
            if self.status != RoomStatus.RUNNING:
                raise GDError("invalid_state", "Scores can only be adjusted while the GD is running.", 409)
            target = self.members.get(participant_id)
            if target is None or not target.is_player:
                raise GDError("not_found", "No such player in this room.", 404)
            created = utcnow()
            with new_session() as s:
                s.add(
                    ScoreAdjustment(
                        room_id=self.room_id,
                        participant_id=target.id,
                        delta=value,
                        reason=reason_txt,
                        by_participant_id=by.id,
                        created_at=created,
                    )
                )
                s.commit()
            self.adjustments.append(Adjustment(target.id, value, reason_txt, by.id, created))
            self.hub.broadcast(
                "score_adjusted",
                {
                    "participant_id": target.id,
                    "name": target.name,
                    "delta": value,
                    "reason": reason_txt,
                    "by": {"participant_id": by.id, "name": by.name},
                    "created_at": iso(created),
                },
            )
            self._broadcast_leaderboard()

    # ==================================================================================
    # Turn engine (call with the lock held)
    # ==================================================================================

    def _enqueue(self, m: Member) -> None:
        if not m.is_ai and self.settings.human_queue_priority:
            # Practice app: humans go ahead of AIs that are waiting (still FIFO among humans).
            idx = next((i for i, pid in enumerate(self.queue) if self.members[pid].is_ai), len(self.queue))
            self.queue.insert(idx, m.id)
        else:
            self.queue.append(m.id)

    def _advance(self) -> None:
        """Give the floor to the next person in the raise-hand queue, if the floor is free."""
        if self.status != RoomStatus.RUNNING or self.active is not None:
            return
        popped = False
        while self.queue:
            pid = self.queue[0]
            m = self.members.get(pid)
            if m is None:
                self.queue.pop(0)
                popped = True
                continue
            # Keep natural TURN_GAP_SECONDS before an AI speaks; humans advance immediately.
            if m.is_ai and time.monotonic() < self._ai_gap_until_mono:
                if popped:
                    self._broadcast_queue()
                return
            if not m.is_ai:
                self._cancel_gap_task()
            self.queue.pop(0)
            self._broadcast_queue()
            self._begin_turn(m)
            return
        if popped:
            self._broadcast_queue()

    def _effective_turn_limit(self) -> int:
        return self.turn_limit_seconds or self.settings.default_turn_limit_seconds

    def _begin_turn(self, m: Member) -> None:
        self.turn_seq += 1
        now = time.monotonic()
        started_at = utcnow()
        limit = self._effective_turn_limit()
        has_valid_prefetch = (
            m.is_ai
            and self._prefetch is not None
            and self._prefetch.participant_id == m.id
            and self._prefetch.history_len == len(self.entries)
            and self._prefetch.ready
            and not self._prefetch.failed
        )
        self.active = ActiveTurn(
            seq=self.turn_seq,
            participant_id=m.id,
            started_mono=now,
            started_at=started_at,
            deadline_mono=now + limit if limit else None,
            deadline_at=started_at + timedelta(seconds=limit) if limit else None,
            phase="speaking" if (not m.is_ai or has_valid_prefetch) else "thinking",
            chosen_mono=now,
        )
        self._broadcast_speaker()
        if m.is_ai:
            self.active.task = self._spawn(self._run_ai_turn(self.active))

    def _record_entry(
        self,
        m: Member,
        turn: ActiveTurn,
        text: str,
        *,
        source: str,
        audio_bytes: bytes | None = None,
        audio_ext: str | None = None,
        audio_duration_seconds: float | None = None,
    ) -> Entry:
        ended = utcnow()
        with new_session() as s:
            row = Turn(
                room_id=self.room_id,
                participant_id=m.id,
                seq=turn.seq,
                status=TurnStatus.COMPLETED,
                text=text,
                source=source,
                started_at=turn.started_at,
                ended_at=ended,
            )
            s.add(row)
            s.commit()
            s.refresh(row)

        turn_id = row.id or 0
        audio_url: str | None = None
        if audio_bytes and turn_id > 0:
            try:
                saved = save_turn_audio(self.code, turn_id, audio_bytes, ext=audio_ext)
                ext = saved.suffix.lstrip(".") or (audio_ext or "mp3")
                audio_url = f"/audio/{self.code}/{turn_id}.{ext}"
            except Exception as exc:
                log.error("Failed to save audio for turn %s in room %s: %s", turn_id, self.code, exc, exc_info=True)
                audio_url = None
                audio_duration_seconds = None

        entry = Entry(
            turn_id=turn_id,
            seq=turn.seq,
            participant_id=m.id,
            name=m.name,
            is_ai=m.is_ai,
            text=text,
            source=source,
            started_at=turn.started_at,
            ended_at=ended,
            audio_url=audio_url,
            audio_duration_seconds=round(audio_duration_seconds, 2) if audio_duration_seconds is not None else None,
        )
        self.entries.append(entry)
        turn.entry_recorded = True
        self.hub.broadcast("transcript_entry", entry.public())
        task = self._spawn(self._score_entry(entry))
        self._scoring_tasks.add(task)
        task.add_done_callback(self._scoring_tasks.discard)
        return entry

    def _skip_active(self, reason: str, *, quiet: bool = False) -> None:
        a = self.active
        if a is None:
            return
        m = self.members[a.participant_id]
        self._cancel_turn_task(a)
        if not a.entry_recorded:
            with new_session() as s:
                s.add(
                    Turn(
                        room_id=self.room_id,
                        participant_id=m.id,
                        seq=a.seq,
                        status=TurnStatus.SKIPPED,
                        source="ai" if m.is_ai else "text",
                        skip_reason=reason,
                        started_at=a.started_at,
                        ended_at=utcnow(),
                    )
                )
                s.commit()
            if not quiet:
                self.hub.broadcast(
                    "turn_skipped", {"participant_id": m.id, "name": m.name, "seq": a.seq, "reason": reason}
                )
        self._release_floor()

    def _release_floor(self) -> None:
        self.active = None
        self._floor_free_since = time.monotonic()
        self._broadcast_speaker()

    def _cancel_turn_task(self, a: ActiveTurn) -> None:
        if a.task is not None and not a.task.done() and a.task is not asyncio.current_task():
            a.task.cancel()

    def _speaking_seconds(self, text: str) -> float:
        wpm = self.settings.ai_speaking_wpm
        if wpm <= 0:
            return 0.0
        base = len(text.split()) / wpm * 60.0
        return max(1.0, base + self.settings.audio_end_buffer_seconds) if wpm <= 200 else base

    def _cancel_gap_task(self) -> None:
        self._ai_gap_until_mono = 0.0
        if self._gap_task is not None and not self._gap_task.done() and self._gap_task is not asyncio.current_task():
            self._gap_task.cancel()
        self._gap_task = None

    def _cancel_prefetch(self, reason: str) -> None:
        pf = self._prefetch
        if pf is None:
            return
        self._prefetch = None
        if not pf.task.done() and pf.task is not asyncio.current_task():
            pf.task.cancel()
        log.debug("Cancelled prefetch (%s) for participant %s in room %s", reason, pf.participant_id, self.code)

    def _sync_prefetch(self, reason: str) -> None:
        """Discard stale prefetch if the queue head or history changed, then prefetch next AI if safe."""
        if self._prefetch is not None:
            valid = (
                self.status == RoomStatus.RUNNING
                and bool(self.queue)
                and self.queue[0] == self._prefetch.participant_id
                and self._prefetch.history_len == len(self.entries)
                and not self._prefetch.failed
            )
            if not valid:
                self._cancel_prefetch(reason)
        self._maybe_start_prefetch()

    def _maybe_start_prefetch(self) -> None:
        """Prefetch the next queued AI ONLY while an AI turn is actively playing (never during a human turn)."""
        if self.status != RoomStatus.RUNNING or self.active is None or not self.active.entry_recorded:
            return
        if not self.queue:
            return
        next_m = self.members.get(self.queue[0])
        if next_m is None or not next_m.is_ai or next_m.persona is None:
            self._cancel_prefetch("next_is_human")
            return
        if (
            self._prefetch is not None
            and self._prefetch.participant_id == next_m.id
            and self._prefetch.history_len == len(self.entries)
            and not self._prefetch.failed
        ):
            return
        self._cancel_prefetch("superseded")
        history = [(e.name, e.text) for e in self.entries[-ai_agent.HISTORY_TURNS :]]
        players = [p.name for p in self.players()]
        placeholder_task = asyncio.current_task()
        assert placeholder_task is not None
        pf = PrefetchState(
            participant_id=next_m.id,
            history_len=len(self.entries),
            task=placeholder_task,
        )
        pf.task = self._spawn(self._run_prefetch(pf, next_m, players, history))
        self._prefetch = pf

    async def _run_prefetch(
        self,
        pf: PrefetchState,
        m: Member,
        participants: list[str],
        history: list[tuple[str, str]],
    ) -> None:
        assert m.persona is not None
        try:
            t0 = time.monotonic()
            gen = await asyncio.wait_for(
                ai_agent.generate_ai_turn(
                    self.llm,
                    name=m.name,
                    persona=m.persona,
                    topic=self.topic,
                    participants=participants,
                    history=history,
                ),
                timeout=self.settings.ai_generation_timeout_seconds,
            )
            pf.llm_ms = (time.monotonic() - t0) * 1000.0
            pf.text = gen.text
            pf.tts_text = gen.tts_text

            t1 = time.monotonic()
            try:
                synth = await asyncio.wait_for(
                    self.tts.synthesize_for_persona(gen.tts_text, persona=m.persona),
                    timeout=self.settings.tts_timeout_seconds,
                )
                if synth and synth.data:
                    pf.audio_bytes = synth.data
                    pf.audio_ext = synth.ext
                    pf.audio_duration = synth.duration_seconds
                    pf.audio_provider = synth.provider
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("Prefetch TTS failed for %s in room %s: %s", m.name, self.code, exc, exc_info=True)
                pf.audio_bytes = None
                pf.audio_ext = None
                pf.audio_duration = None
                pf.audio_provider = None
            pf.tts_ms = (time.monotonic() - t1) * 1000.0
            pf.ready = True
            log.info(
                "[TIMING] room=%s prefetch ready for %s (provider=%s ext=%s llm=%.0fms tts=%.0fms dur=%s)",
                self.code,
                m.name,
                pf.audio_provider,
                pf.audio_ext,
                pf.llm_ms,
                pf.tts_ms,
                pf.audio_duration,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            pf.failed = True
            log.error("Prefetch LLM failed for %s in room %s: %s", m.name, self.code, exc, exc_info=True)

    def _schedule_next_after_ai(self, audio_end_mono: float) -> None:
        """Release the floor after an AI turn and advance after TURN_GAP_SECONDS (or 0ms if human is next)."""
        self._last_audio_ended_mono = audio_end_mono
        self._release_floor()
        # Clean invalid queue entries from front
        while self.queue and self.queue[0] not in self.members:
            self.queue.pop(0)
        if self.queue:
            head = self.members[self.queue[0]]
            if not head.is_ai:
                self._cancel_gap_task()
                self._advance()
                return
        gap = self.settings.turn_gap_seconds if self.settings.ai_speaking_wpm > 0 else 0.0
        if gap <= 0:
            self._cancel_gap_task()
            self._advance()
            return
        self._cancel_gap_task()
        target = audio_end_mono + gap
        self._ai_gap_until_mono = target
        self._gap_task = self._spawn(self._advance_after_gap(target))

    async def _advance_after_gap(self, target_mono: float) -> None:
        try:
            delay = target_mono - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
            async with self.lock:
                self._gap_task = None
                self._ai_gap_until_mono = 0.0
                if self.status != RoomStatus.RUNNING or self.active is not None:
                    return
                if self.queue:
                    self._advance()
                    return
                # Queue is empty: immediately let an eligible AI pick up the discussion.
                picked = self._pick_idle_ai()
                if picked is not None:
                    self._ai_raise(picked)
        except asyncio.CancelledError:
            raise

    def _pick_idle_ai(self) -> Member | None:
        players = self.players()
        ais = [m for m in players if m.is_ai and m.persona is not None]
        if not ais:
            return None
        active_id = self.active.participant_id if self.active else None
        candidates = [m for m in ais if m.id not in self.queue and m.id != active_id]
        if not candidates:
            return None
        recent_speakers = [e.participant_id for e in self.entries[-2:]]
        last_speaker = recent_speakers[-1] if recent_speakers else None
        window = 1 if len(players) <= 3 else 2
        recent = set(recent_speakers[-window:])
        pool = (
            [m for m in candidates if m.id not in recent]
            or [m for m in candidates if m.id != last_speaker]
            or candidates
        )
        weights = [m.persona.eagerness for m in pool]  # type: ignore[union-attr]
        return self._rng.choices(pool, weights=weights, k=1)[0]

    # ==================================================================================
    # Background tasks
    # ==================================================================================

    async def _run_ai_turn(self, turn: ActiveTurn) -> None:
        m = self.members[turn.participant_id]
        assert m.persona is not None
        history = [(e.name, e.text) for e in self.entries[-ai_agent.HISTORY_TURNS :]]
        timeout = self.settings.ai_generation_timeout_seconds
        if turn.deadline_mono is not None:
            timeout = max(1.0, min(timeout, turn.deadline_mono - time.monotonic()))

        prefetch: PrefetchState | None = None
        async with self.lock:
            if (
                self._prefetch is not None
                and self._prefetch.participant_id == m.id
                and self._prefetch.history_len == len(self.entries)
                and not self._prefetch.failed
            ):
                prefetch = self._prefetch
                self._prefetch = None

        text: str | None = None
        tts_text: str | None = None
        audio_bytes: bytes | None = None
        audio_ext: str | None = None
        audio_duration: float | None = None
        audio_provider: str | None = None
        llm_ms = 0.0
        tts_ms = 0.0
        used_prefetch = False

        if prefetch is not None:
            try:
                if not prefetch.task.done():
                    await asyncio.wait_for(asyncio.shield(prefetch.task), timeout=timeout)
                if prefetch.ready and prefetch.text:
                    text = prefetch.text
                    tts_text = prefetch.tts_text
                    audio_bytes = prefetch.audio_bytes
                    audio_ext = prefetch.audio_ext
                    audio_duration = prefetch.audio_duration
                    audio_provider = prefetch.audio_provider
                    llm_ms = prefetch.llm_ms
                    tts_ms = prefetch.tts_ms
                    used_prefetch = True
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("Prefetch await failed for %s: %s", m.name, exc)

        if not used_prefetch:
            try:
                t0 = time.monotonic()
                gen = await asyncio.wait_for(
                    ai_agent.generate_ai_turn(
                        self.llm,
                        name=m.name,
                        persona=m.persona,
                        topic=self.topic,
                        participants=[p.name for p in self.players()],
                        history=history,
                    ),
                    timeout=timeout,
                )
                text = gen.text
                tts_text = gen.tts_text
                llm_ms = (time.monotonic() - t0) * 1000.0
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("AI turn failed for %s in room %s: %s", m.name, self.code, exc, exc_info=True)
                async with self.lock:
                    if self.active is turn:
                        self._skip_active("ai_error", quiet=True)
                        self._advance()
                return

            t1 = time.monotonic()
            try:
                synth = await asyncio.wait_for(
                    self.tts.synthesize_for_persona(tts_text, persona=m.persona),
                    timeout=self.settings.tts_timeout_seconds,
                )
                if synth and synth.data:
                    audio_bytes = synth.data
                    audio_ext = synth.ext
                    audio_duration = synth.duration_seconds
                    audio_provider = synth.provider
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("TTS failed for %s in room %s: %s", m.name, self.code, exc, exc_info=True)
                audio_bytes = None
                audio_ext = None
                audio_duration = None
                audio_provider = None
            tts_ms = (time.monotonic() - t1) * 1000.0

        assert text is not None
        async with self.lock:
            if self.active is not turn or self.status != RoomStatus.RUNNING:
                return
            entry = self._record_entry(
                m,
                turn,
                text,
                source="ai",
                audio_bytes=audio_bytes,
                audio_ext=audio_ext,
                audio_duration_seconds=audio_duration,
            )
            turn.turn_id = entry.turn_id
            now = time.monotonic()
            prev_end_to_chosen = (
                (turn.chosen_mono - self._last_audio_ended_mono) * 1000.0
                if self._last_audio_ended_mono is not None
                else 0.0
            )
            prev_end_to_ready = (
                (now - self._last_audio_ended_mono) * 1000.0
                if self._last_audio_ended_mono is not None
                else 0.0
            )
            log.info(
                "[TIMING] room=%s turn_id=%d speaker=%s prefetched=%s tts=%s/%s prev_end_to_chosen=%.0fms "
                "llm=%.0fms tts_ms=%.0fms prev_end_to_ready=%.0fms audio_dur=%s",
                self.code,
                entry.turn_id,
                m.name,
                used_prefetch,
                audio_provider,
                audio_ext,
                prev_end_to_chosen,
                llm_ms,
                tts_ms,
                prev_end_to_ready,
                audio_duration,
            )

            if audio_duration is not None and audio_duration > 0:
                fallback_hold = audio_duration + self.settings.audio_end_buffer_seconds
            else:
                fallback_hold = self._speaking_seconds(text)
            if self.turn_limit_seconds is not None and turn.deadline_mono is not None:
                fallback_hold = min(fallback_hold, max(0.0, turn.deadline_mono - now))
            elif fallback_hold > 0:
                turn.deadline_mono = now + fallback_hold + 2.0
                turn.deadline_at = utcnow() + timedelta(seconds=fallback_hold + 2.0)

            if fallback_hold <= 0:
                self._schedule_next_after_ai(now)
                return

            turn.phase = "speaking"
            self._broadcast_speaker()
            self._maybe_start_prefetch()

        try:
            await asyncio.wait_for(turn.playback_done.wait(), timeout=fallback_hold)
            ended_by = "client_ended"
        except asyncio.TimeoutError:
            ended_by = "server_timer"

        async with self.lock:
            if self.active is turn:
                audio_end = turn.playback_ended_mono or time.monotonic()
                log.info(
                    "[TIMING] room=%s turn_id=%s speaker=%s ended_by=%s",
                    self.code,
                    turn.turn_id,
                    m.name,
                    ended_by,
                )
                self._schedule_next_after_ai(audio_end)

    async def _score_entry(self, entry: Entry) -> None:
        idx = self.entries.index(entry)
        context = [(e.name, e.text) for e in self.entries[max(0, idx - scoring.CONTEXT_TURNS) : idx]]
        started = time.monotonic()
        try:
            result = await scoring.score_turn(
                self.llm, topic=self.topic, speaker=entry.name, text=entry.text, context=context
            )
        except Exception as exc:
            log.warning("Scoring failed for turn %s in room %s: %s", entry.turn_id, self.code, exc)
            return
        async with self.lock:
            entry.scores = result.scores
            entry.comment = result.comment
            entry.turn_score = result.turn_score
            with new_session() as s:
                row = s.get(Turn, entry.turn_id)
                if row is not None:
                    row.relevance, row.clarity = result.relevance, result.clarity
                    row.content, row.teamwork = result.content, result.teamwork
                    row.comment, row.turn_score = result.comment, result.turn_score
                    s.add(row)
                    s.commit()
            self.hub.broadcast("turn_scored", entry.score_public())
            self._broadcast_leaderboard()
            log.info("[TIMING] room=%s turn_id=%d scored in %.0fms", self.code, entry.turn_id, (time.monotonic() - started) * 1000.0)

    async def _tick_loop(self) -> None:
        assert self._started_mono is not None and self._ends_mono is not None
        try:
            while self.status == RoomStatus.RUNNING:
                now = time.monotonic()
                self.hub.broadcast("timer", self.timer_public(now))
                if now >= self._ends_mono - 0.05:
                    await self.end("timer")
                    return
                async with self.lock:
                    self._on_tick(now)
                elapsed = time.monotonic() - self._started_mono
                next_boundary = self._started_mono + math.floor(elapsed) + 1
                await asyncio.sleep(max(0.0, next_boundary - time.monotonic()))
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Tick loop crashed in room %s", self.code)

    def _on_tick(self, now: float) -> None:
        if self.status != RoomStatus.RUNNING:
            return
        a = self.active
        if a is not None and a.deadline_mono is not None and now >= a.deadline_mono:
            if a.entry_recorded:  # AI already spoke; its speaking time just ran out
                self._cancel_turn_task(a)
                self._release_floor()
            else:
                self._skip_active("time_up")
            self._advance()
        self._ai_hand_raising(now)

    def _ai_hand_raising(self, now: float) -> None:
        """AIs raise their hands on their own, probabilistically, and step in when the floor goes quiet."""
        if self.status != RoomStatus.RUNNING:
            return
        players = self.players()
        ais = [m for m in players if m.is_ai and m.persona is not None]
        if not ais:
            return
        active_id = self.active.participant_id if self.active else None
        candidates = [m for m in ais if m.id not in self.queue and m.id != active_id]
        if not candidates:
            return

        recent_speakers = [e.participant_id for e in self.entries[-2:]]
        last_speaker = recent_speakers[-1] if recent_speakers else None
        window = 1 if len(players) <= 3 else 2
        recent = set(recent_speakers[-window:])

        # While an AI is actively speaking and queue is empty, queue the next AI early so prefetch can run.
        if (
            self.active is not None
            and self.active.entry_recorded
            and not self.queue
            and (now - self.active.started_mono) >= 0.3
        ):
            picked = self._pick_idle_ai()
            if picked is not None:
                self._ai_raise(picked)
            return

        floor_idle = self.active is None and not self.queue and self._gap_task is None
        idle_for = now - self._floor_free_since if floor_idle else 0.0
        nudge = self.settings.ai_idle_nudge_seconds

        if floor_idle and idle_for >= nudge:
            picked = self._pick_idle_ai()
            if picked is not None:
                self._ai_raise(picked)
            return

        ai_waiting = sum(1 for pid in self.queue if self.members[pid].is_ai)
        if ai_waiting >= self.settings.ai_max_queued:
            return
        last_text = self.entries[-1].text if self.entries else ""
        self._rng.shuffle(candidates)
        for m in candidates:
            if m.id in recent:
                continue
            p = ai_agent.hand_raise_probability(
                m.persona,  # type: ignore[arg-type]
                mentioned=bool(last_text) and ai_agent.is_mentioned(m.name, last_text),
                multiplier=self.settings.ai_hand_raise_multiplier,
            )
            if self._rng.random() < p:
                self._ai_raise(m)
                return

    def _ai_raise(self, m: Member) -> None:
        self._enqueue(m)
        self._broadcast_queue()
        self._sync_prefetch("ai_raise")
        self._advance()

    async def _build_report(self) -> None:
        pending = set(self._scoring_tasks)
        if pending:
            await asyncio.wait(pending, timeout=REPORT_SCORING_WAIT_SECONDS)
        try:
            board = self.leaderboard()
            by_id = {row["participant_id"]: row for row in board}

            async def feedback_for(m: Member) -> dict[str, Any]:
                stats = by_id[m.id]
                mine = [e for e in self.entries if e.participant_id == m.id]
                if not mine:
                    return scoring.no_contribution_feedback()
                try:
                    return await scoring.generate_feedback(
                        self.llm,
                        topic=self.topic,
                        name=m.name,
                        turns=[(e.text, e.scores, e.comment) for e in mine],
                        stats=stats,
                    )
                except Exception as exc:
                    log.warning("Report feedback failed for %s: %s", m.name, exc)
                    return scoring.fallback_feedback(stats)

            players = [self.members[row["participant_id"]] for row in board]
            feedbacks = await asyncio.gather(*(feedback_for(m) for m in players))

            participants = []
            for row, m, fb in zip(board, players, feedbacks):
                participants.append(
                    {
                        "participant_id": m.id,
                        "name": m.name,
                        "is_ai": m.is_ai,
                        "persona": m.persona.public() if m.persona else None,
                        "rank": row["rank"],
                        "total_score": row["total_score"],
                        "turns": row["turns"],
                        "average": row["average"],
                        "average_turn_score": row["average_turn_score"],
                        "adjustments": row["adjustments"],
                        "strengths": fb["strengths"],
                        "improvements": fb["improvements"],
                        "summary": fb["summary"],
                    }
                )
            best = next((p for p in participants if p["turns"] > 0), None)
            report = {
                "room_code": self.code,
                "topic": self.topic,
                "generated_at": iso(utcnow()),
                "started_at": iso(self.started_at),
                "ended_at": iso(self.ended_at),
                "end_reason": self.end_reason,
                "total_turns": len(self.entries),
                "best_performer": (
                    {
                        "participant_id": best["participant_id"],
                        "name": best["name"],
                        "is_ai": best["is_ai"],
                        "total_score": best["total_score"],
                        "reason": best["summary"],
                    }
                    if best
                    else None
                ),
                "participants": participants,
            }
        except Exception:
            log.exception("Report generation failed for room %s", self.code)
            async with self.lock:
                self.report_status = "failed"
                self.hub.broadcast("report_failed", {"message": "Report generation failed."})
            return

        async with self.lock:
            self.report = report
            self.report_status = "ready"
            self._persist_room(report=report)
            self.hub.broadcast("report_ready", {"report": report})
        log.info("Report ready for room %s (best: %s)", self.code, report["best_performer"])

    # ==================================================================================
    # Helpers
    # ==================================================================================

    def _create_member(self, *, name: str, role: Role, is_ai: bool, persona: Persona | None) -> Member:
        with new_session() as s:
            row = Participant(
                room_id=self.room_id,
                name=name,
                role=role,
                is_ai=is_ai,
                persona_key=persona.key if persona else None,
                token=secrets.token_urlsafe(24),
            )
            s.add(row)
            s.commit()
            s.refresh(row)
        assert row.id is not None
        member = Member(
            id=row.id, name=name, role=role, is_ai=is_ai, persona=persona, token=row.token, joined_at=row.joined_at
        )
        self.members[member.id] = member
        return member

    def _persist_room(self, **fields: Any) -> None:
        with new_session() as s:
            room = s.get(Room, self.room_id)
            if room is None:
                return
            for key, value in fields.items():
                setattr(room, key, value)
            s.add(room)
            s.commit()

    def _require_moderator(self, m: Member) -> None:
        if not self.can_moderate(m):
            raise GDError("not_moderator", "Only the moderator can do that.", 403)

    def _require_player(self, m: Member) -> None:
        if not m.is_player:
            raise GDError("not_player", "Only players can do that.", 403)

    def _require_running(self) -> None:
        if self.status != RoomStatus.RUNNING:
            raise GDError("invalid_state", f"The GD is {self.status.value}, not running.", 409)

    def _broadcast_participants(self) -> None:
        self.hub.broadcast("participants", {"participants": self.participants_public()})

    def _broadcast_queue(self) -> None:
        self.hub.broadcast("queue", {"queue": self.queue_public()})

    def _broadcast_speaker(self) -> None:
        self.hub.broadcast("speaker_changed", {"speaker": self.speaker_public()})

    def _broadcast_leaderboard(self) -> None:
        self.hub.broadcast("leaderboard", {"leaderboard": self.leaderboard()})

    def _spawn(self, coro: Coroutine[Any, Any, Any]) -> asyncio.Task[Any]:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._on_task_done)
        return task

    def _on_task_done(self, task: asyncio.Task[Any]) -> None:
        self._tasks.discard(task)
        if not task.cancelled() and task.exception() is not None:
            log.error("Background task failed in room %s", self.code, exc_info=task.exception())

    @property
    def idle(self) -> bool:
        return self.status == RoomStatus.FINISHED and self.hub.client_count == 0 and self.report_status != "generating"

    async def shutdown(self) -> None:
        self._cancel_gap_task()
        self._cancel_prefetch("shutdown")
        for task in list(self._tasks):
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        cleanup_room_audio(self.code)


# ======================================================================================
# Message parsing helpers
# ======================================================================================


def _opt_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        raise GDError("invalid_message", "'participant_id' must be an integer.") from None


def _req_int(msg: dict[str, Any], key: str) -> int:
    value = _opt_int(msg.get(key))
    if value is None:
        raise GDError("invalid_message", f"'{key}' is required.")
    return value


def _speech_input(msg: dict[str, Any]) -> SpeechInput:
    text = msg.get("text")
    if text is not None and not isinstance(text, str):
        raise GDError("invalid_message", "'text' must be a string.")
    audio = None
    if msg.get("audio_b64"):
        try:
            audio = base64.b64decode(msg["audio_b64"], validate=True)
        except (binascii.Error, ValueError, TypeError):
            raise GDError("invalid_message", "'audio_b64' is not valid base64.") from None
    source_val = "voice" if msg.get("source") == "voice" else "text"
    return SpeechInput(
        text=text,
        audio=audio,
        mime_type=msg.get("mime_type"),
        language=str(msg.get("language") or "en"),
        source=source_val,
    )

