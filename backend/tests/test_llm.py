"""Unit tests for the LLM wrapper, startup model verification, STT, scoring, and turn flow."""

import asyncio
import json
import time
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.core.registry import generate_code
from app.core.runtime import RoomRuntime
from app.db import init_db, new_session
from app.main import app
from app.models import Role, Room
from app.services import ai_agent, scoring, stt as stt_svc, tts as tts_svc
from app.services.llm import (
    LLMClient,
    LLMError,
    LLMRateLimitError,
    OpenAICompatibleLLM,
    parse_json_object,
    strip_reasoning,
    verify_provider_models,
)
from app.services.personas import CORE_PERSONAS, assign_personas
from app.services.stt import GroqWhisperSTT, MockSTT
from app.services.tts import (
    EdgeTTS,
    MockTTS,
    NullTTS,
    cleanup_room_audio,
    get_turn_audio_path,
    mp3_duration_seconds,
    save_turn_audio,
    verify_tts_voices,
)


def _completion(content: str) -> dict:
    return {
        "id": "x", "object": "chat.completion", "created": 0, "model": "m",
        "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": content}}],
    }


def _client(handler, *, reasoning_effort: str | None = "low") -> OpenAICompatibleLLM:
    return OpenAICompatibleLLM(
        provider="test", api_key="k", base_url="http://llm.test/v1", model="m",
        reasoning_effort=reasoning_effort,
        max_retries=3, backoff_base=0.01, backoff_max=0.05,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )


def test_retries_on_429_then_succeeds() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] <= 2:
            return httpx.Response(429, headers={"retry-after": "0"}, json={"error": {"message": "slow down"}})
        return httpx.Response(200, json=_completion("hello"))

    assert asyncio.run(_client(handler).chat([{"role": "user", "content": "hi"}])) == "hello"
    assert calls["n"] == 3


def test_gives_up_after_max_retries() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {"message": "slow down"}})

    with pytest.raises(LLMRateLimitError):
        asyncio.run(_client(handler).chat([{"role": "user", "content": "hi"}]))


def test_json_mode_falls_back_when_rejected() -> None:
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append("response_format" in body)
        if "response_format" in body:
            return httpx.Response(400, json={"error": {"message": "json_validate_failed"}})
        return httpx.Response(200, json=_completion('Sure: {"a": 1}'))

    assert asyncio.run(_client(handler).chat_json([{"role": "user", "content": "x"}])) == {"a": 1}
    assert seen == [True, False]


def test_strip_reasoning_and_reasoning_effort_fallback() -> None:
    assert strip_reasoning("<think>internal steps</think>\nFinal answer.") == "Final answer."
    assert strip_reasoning("<think>unclosed thinking") == ""

    seen_efforts: list[object] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen_efforts.append(body.get("reasoning_effort"))
        if "reasoning_effort" in body:
            return httpx.Response(400, json={"error": {"message": "Unknown parameter: reasoning_effort"}})
        return httpx.Response(200, json=_completion("<think>hmm</think>Concise point."))

    out = asyncio.run(_client(handler, reasoning_effort="low").chat([{"role": "user", "content": "hi"}]))
    assert out == "Concise point."
    assert seen_efforts == ["low", None]


def test_chat_json_repairs_malformed_json() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(200, json=_completion("Here is the score: relevance 8, clarity 7 (broken json)"))
        return httpx.Response(200, json=_completion('{"relevance": 8, "clarity": 7, "content": 7, "teamwork": 8, "comment": "Good"}'))

    res = asyncio.run(_client(handler).chat_json([{"role": "user", "content": "score"}]))
    assert res["relevance"] == 8
    assert calls["n"] == 2


def test_parse_json_object() -> None:
    assert parse_json_object('```json\n{"x": 2}\n```') == {"x": 2}
    assert parse_json_object('Here you go {"x": 3,} thanks') == {"x": 3}
    assert parse_json_object('<think>reason</think>{"x": 4}') == {"x": 4}
    with pytest.raises(LLMError):
        parse_json_object("no json here")


def test_verify_provider_models_ok_and_fallback() -> None:
    def make_client(model_ids: list[str]) -> httpx.AsyncClient:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"data": [{"id": mid} for mid in model_ids]})
        return httpx.AsyncClient(transport=httpx.MockTransport(handler))

    settings = Settings(groq_api_key="test-key", llm_model="openai/gpt-oss-120b", stt_model="whisper-large-v3-turbo")

    # Both configured models available -> OK, unchanged
    llm = OpenAICompatibleLLM(provider="groq", api_key="k", base_url="http://llm.test/v1", model="openai/gpt-oss-120b")
    stt = GroqWhisperSTT(api_key="k", base_url="http://llm.test/v1", model="whisper-large-v3-turbo")
    res_ok = asyncio.run(
        verify_provider_models(
            settings,
            llm,
            stt,
            http_client=make_client(["openai/gpt-oss-120b", "whisper-large-v3-turbo"]),
        )
    )
    assert res_ok["status"] == "ok"
    assert llm.model == "openai/gpt-oss-120b"
    assert stt.model == "whisper-large-v3-turbo"

    # Configured models missing -> falls back to qwen/qwen3.6-27b and whisper-large-v3
    res_fb = asyncio.run(
        verify_provider_models(
            settings,
            llm,
            stt,
            http_client=make_client(["qwen/qwen3.6-27b", "whisper-large-v3"]),
        )
    )
    assert res_fb["status"] == "ok"
    assert llm.model == "qwen/qwen3.6-27b"
    assert stt.model == "whisper-large-v3"


def test_post_stt_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.rooms.get_stt", lambda: MockSTT())
    client = TestClient(app)

    ok_resp = client.post(
        "/stt",
        files={"file": ("turn.webm", b"fake-audio-bytes", "audio/webm")},
        data={"language": "en"},
    )
    assert ok_resp.status_code == 200
    assert ok_resp.json()["text"]
    assert ok_resp.json()["source"] == "voice"

    empty_resp = client.post(
        "/stt",
        files={"file": ("turn.webm", b"", "audio/webm")},
    )
    assert empty_resp.status_code == 400
    assert empty_resp.json()["error"]["code"] == "empty_audio"


def test_clean_speech_truncates_to_60_words() -> None:
    long = "Arjun: " + " ".join(f"word{i}" for i in range(100))
    out = ai_agent.clean_speech(long, name="Arjun")
    assert not out.startswith("Arjun")
    assert len(out.split()) <= 60


def test_assign_personas_distinct_and_core_first() -> None:
    picks = assign_personas(7, {"Arjun"})
    keys = [p.key for p, _ in picks]
    assert len(set(keys)) == 7
    assert set(keys[:5]) == {p.key for p in CORE_PERSONAS}
    assert "Arjun" not in [name for _, name in picks]


def test_leaderboard_totals() -> None:
    class P:
        def __init__(self, id, name): self.id, self.name, self.is_ai = id, name, False

    class E:
        def __init__(self, pid, s): self.participant_id, self.scores, self.turn_score = pid, s, sum(s.values()) / 4

    class A:
        def __init__(self, pid, d): self.participant_id, self.delta = pid, d

    s8 = dict.fromkeys(scoring.CRITERIA, 8)
    s6 = dict.fromkeys(scoring.CRITERIA, 6)
    board = scoring.compute_leaderboard([P(1, "a"), P(2, "b")], [E(1, s6), E(2, s8)], [A(1, 3)])
    assert [r["participant_id"] for r in board] == [1, 2]
    assert board[0]["total_score"] == 9 and board[1]["total_score"] == 8


class _FailingLLM(LLMClient):
    provider = "failing"
    model = "fail-model"

    def __init__(self) -> None:
        self.calls = 0

    async def chat(self, messages, *, temperature=0.7, max_tokens=300, json_mode=False, purpose="generic", metadata=None):
        self.calls += 1
        raise LLMError("simulated failure")


def test_turn_flow_timeout_leaderboard_and_quiet_ai_skip() -> None:
    async def scenario() -> None:
        init_db()
        with new_session() as s:
            room = Room(
                code=generate_code(),
                topic="Test turn flow",
                max_participants=3,
                duration_seconds=120,
                turn_limit_seconds=None,
                fill_with_ai=True,
            )
            s.add(room)
            s.commit()
            s.refresh(room)

        llm = _FailingLLM()
        settings = Settings(llm_provider="mock", default_turn_limit_seconds=60, ai_speaking_wpm=0)
        rt = RoomRuntime(room, [], [], [], settings=settings, llm=llm, stt=stt_svc.TextOnlySTT())

        human = await rt.join("Human", Role.PLAYER)
        await rt.start(human)

        # Leaderboard must include all 3 players (human + 2 AIs) right from start.
        board = rt.leaderboard()
        assert len(board) == 3
        assert sum(1 for row in board if row["is_ai"]) == 2

        # Human raises hand and gets the floor; default 60s turn deadline is set.
        await rt.raise_hand(human)
        assert rt.active is not None
        assert rt.active.participant_id == human.id
        assert rt.active.deadline_mono is not None

        # An AI raises its hand while human speaks -> stays queued, LLM NOT called yet.
        ai_player = next(m for m in rt.players() if m.is_ai)
        async with rt.lock:
            rt._ai_raise(ai_player)
        assert ai_player.id in rt.queue
        assert llm.calls == 0

        # Simulate silent human hitting the turn deadline -> auto-skipped, queued AI gets floor.
        skipped_events: list[dict] = []
        orig_broadcast = rt.hub.broadcast
        def spy_broadcast(event_type: str, data: dict) -> None:
            if event_type == "turn_skipped":
                skipped_events.append(data)
            orig_broadcast(event_type, data)
        rt.hub.broadcast = spy_broadcast  # type: ignore[method-assign]

        async with rt.lock:
            rt._on_tick(rt.active.deadline_mono + 0.1)
        assert any(e["reason"] == "time_up" for e in skipped_events)
        assert rt.active is not None
        assert rt.active.participant_id == ai_player.id

        # Let the failing AI turn task(s) finish -> skipped quietly (no ai_error in turn_skipped), floor released.
        await asyncio.sleep(0.05)
        assert rt.active is None
        assert llm.calls >= 1
        assert not any(e["reason"] == "ai_error" for e in skipped_events)
        await rt.shutdown()

    asyncio.run(scenario())


def test_tts_storage_endpoints_and_voice_verification(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    mock_tts = MockTTS()
    mp3 = asyncio.run(mock_tts.synthesize("Hello group.", voice="en-IN-NeerjaNeural"))
    assert len(mp3) > 0
    dur = mp3_duration_seconds(mp3)
    assert dur is not None and dur > 0

    # Audio file storage + HTTP serving + cleanup
    code = "TTS99"
    saved = save_turn_audio(code, 7, mp3, base_dir=tmp_path)
    assert saved.is_file()
    assert get_turn_audio_path(code, 7, base_dir=tmp_path) == saved

    monkeypatch.setattr("app.api.rooms.get_turn_audio_path", lambda rc, tid: get_turn_audio_path(rc, tid, base_dir=tmp_path))
    monkeypatch.setattr("app.api.rooms.get_tts", lambda: mock_tts)
    client = TestClient(app)

    audio_resp = client.get(f"/audio/{code}/7.mp3")
    assert audio_resp.status_code == 200
    assert audio_resp.headers["content-type"].startswith("audio/mpeg")
    assert audio_resp.content == mp3

    assert client.get(f"/audio/{code}/999.mp3").status_code == 404

    tts_test_ok = client.post("/tts/test", json={"voice": "en-IN-NeerjaNeural"})
    assert tts_test_ok.status_code == 200
    assert tts_test_ok.headers["content-type"].startswith("audio/mpeg")
    assert tts_test_ok.content == mp3

    monkeypatch.setattr("app.api.rooms.get_tts", lambda: NullTTS())
    tts_test_off = client.post("/tts/test")
    assert tts_test_off.status_code == 400
    assert tts_test_off.json()["error"]["code"] == "tts_disabled"

    cleanup_room_audio(code, base_dir=tmp_path)
    assert get_turn_audio_path(code, 7, base_dir=tmp_path) is None

    # Startup voice verification with fallback when a configured voice is missing
    edge = EdgeTTS()
    async def fake_list_voices():
        return [
            {"ShortName": "en-IN-NeerjaNeural", "Locale": "en-IN"},
            {"ShortName": "en-US-JennyNeural", "Locale": "en-US"},
        ]
    async def fake_synth(text: str, voice: str = "en-US-JennyNeural", *, rate: str = "+0%") -> bytes:
        return mp3
    monkeypatch.setattr(edge, "synthesize", fake_synth)
    report = asyncio.run(verify_tts_voices(edge, list_voices_fn=fake_list_voices))
    assert report["status"] == "ok"
    assert edge.resolve_voice("en-IN-NeerjaNeural") == "en-IN-NeerjaNeural"
    assert edge.resolve_voice("en-GB-RyanNeural") in {"en-IN-NeerjaNeural", "en-US-JennyNeural"}


def test_runtime_ai_turn_emits_audio_url_and_cleans_up_and_falls_back_on_tts_error() -> None:
    class _OkLLM(LLMClient):
        provider = "mock"
        model = "mock-gd"
        async def chat(self, messages, *, temperature=0.7, max_tokens=300, json_mode=False, purpose="generic", metadata=None):
            if purpose == "score":
                return '{"relevance": 8, "clarity": 8, "content": 8, "teamwork": 8, "comment": "Good point."}'
            if purpose == "report":
                return '{"strengths": ["Clear"], "improvements": ["More data"], "summary": "Solid."}'
            return "Clear opening point with practical policy focus for everyone involved."

    class _BrokenTTS(tts_svc.TextToSpeech):
        name = "broken"
        async def synthesize(self, text: str, voice: str = "en-US-JennyNeural", *, rate: str = "+0%") -> bytes:
            raise tts_svc.TTSError("network blocked")

    async def scenario() -> None:
        init_db()
        with new_session() as s:
            room = Room(
                code=generate_code(),
                topic="TTS runtime test",
                max_participants=2,
                duration_seconds=120,
                turn_limit_seconds=None,
                fill_with_ai=True,
            )
            s.add(room)
            s.commit()
            s.refresh(room)

        # 1. Happy path with MockTTS -> emits audio_url + audio_duration_seconds, cleans up on end()
        settings = Settings(llm_provider="mock", ai_speaking_wpm=150)
        rt = RoomRuntime(room, [], [], [], settings=settings, llm=_OkLLM(), stt=stt_svc.TextOnlySTT(), tts=MockTTS())
        human = await rt.join("Host", Role.PLAYER)
        await rt.start(human)
        ai_player = next(m for m in rt.players() if m.is_ai)
        async with rt.lock:
            rt._ai_raise(ai_player)
        await asyncio.sleep(0.15)
        assert len(rt.entries) == 1
        entry = rt.entries[0]
        assert entry.audio_url == f"/audio/{rt.code}/{entry.turn_id}.mp3"
        assert entry.audio_duration_seconds is not None and entry.audio_duration_seconds > 0
        assert get_turn_audio_path(rt.code, entry.turn_id) is not None
        await rt.end("moderator", by=human)
        assert get_turn_audio_path(rt.code, entry.turn_id) is None
        await rt.shutdown()

        # 2. Broken TTS -> logs error, sets audio_url=None, turn still succeeds using word-count fallback
        with new_session() as s:
            room2 = Room(
                code=generate_code(),
                topic="TTS fallback test",
                max_participants=2,
                duration_seconds=120,
                turn_limit_seconds=None,
                fill_with_ai=True,
            )
            s.add(room2)
            s.commit()
            s.refresh(room2)
        rt2 = RoomRuntime(room2, [], [], [], settings=settings, llm=_OkLLM(), stt=stt_svc.TextOnlySTT(), tts=_BrokenTTS())
        human2 = await rt2.join("Host2", Role.PLAYER)
        await rt2.start(human2)
        ai_player2 = next(m for m in rt2.players() if m.is_ai)
        async with rt2.lock:
            rt2._ai_raise(ai_player2)
        await asyncio.sleep(0.1)
        assert len(rt2.entries) == 1
        assert rt2.entries[0].audio_url is None
        assert rt2.entries[0].text
        await rt2.shutdown()

    asyncio.run(scenario())


def test_prefetch_playback_ended_and_human_preemption() -> None:
    class _CountingLLM(LLMClient):
        provider = "mock"
        model = "mock-gd"

        def __init__(self) -> None:
            self.turn_calls: list[str] = []

        async def chat(self, messages, *, temperature=0.7, max_tokens=300, json_mode=False, purpose="generic", metadata=None):
            if purpose == "score":
                return '{"relevance": 8, "clarity": 8, "content": 8, "teamwork": 8, "comment": "Good."}'
            if purpose == "report":
                return '{"strengths": ["Clear"], "improvements": ["More"], "summary": "Good."}'
            await asyncio.sleep(0.05)
            name = (metadata or {}).get("name", "AI")
            self.turn_calls.append(name)
            return f"Point from {name} about practical implementation and clear metrics."

    async def scenario() -> None:
        init_db()
        with new_session() as s:
            room = Room(
                code=generate_code(),
                topic="Prefetch test",
                max_participants=3,
                duration_seconds=120,
                turn_limit_seconds=None,
                fill_with_ai=True,
            )
            s.add(room)
            s.commit()
            s.refresh(room)

        llm = _CountingLLM()
        settings = Settings(
            llm_provider="mock",
            ai_speaking_wpm=150,
            turn_gap_seconds=0.3,
            audio_end_buffer_seconds=0.2,
        )
        # Use a ~2.0s silent MP3 so AI #1 stays speaking while AI #2 prefetches
        class _TwoSecTTS(tts_svc.TextToSpeech):
            name = "two_sec"
            async def synthesize(self, text: str, voice: str = "en-US-JennyNeural", *, rate: str = "+0%") -> bytes:
                return tts_svc._make_silent_mp3(frames=77)  # ~2.01s

        rt = RoomRuntime(room, [], [], [], settings=settings, llm=llm, stt=stt_svc.TextOnlySTT(), tts=_TwoSecTTS())
        human = await rt.join("Host", Role.PLAYER)
        await rt.start(human)
        ais = [m for m in rt.players() if m.is_ai]

        # 1. Queue AI 1 and AI 2 -> AI 1 starts, AI 2 prefetches while AI 1 speaks
        async with rt.lock:
            rt._ai_raise(ais[0])
            rt._ai_raise(ais[1])
        await asyncio.sleep(0.2)
        assert len(rt.entries) == 1
        assert rt.active is not None and rt.active.participant_id == ais[0].id
        assert rt._prefetch is not None and rt._prefetch.participant_id == ais[1].id
        assert rt._prefetch.ready is True
        calls_before_advance = len(llm.turn_calls)

        # 2. Report playback_ended -> waits ~turn_gap_seconds (0.3s) then consumes prefetch (no extra LLM call)
        await rt.report_playback_ended(rt.entries[0].turn_id)
        await rt.report_playback_ended(rt.entries[0].turn_id)  # duplicate is harmlessly ignored
        await asyncio.sleep(0.05)
        assert rt.active is None  # still inside turn_gap_seconds
        await asyncio.sleep(0.35)
        assert len(rt.entries) == 2
        assert rt.active is not None and rt.active.participant_id == ais[1].id
        assert len(llm.turn_calls) == calls_before_advance  # used prefetched result!

        # 3. Queue AI 1 behind AI 2 -> starts prefetching for AI 1; then human raises hand -> prefetch discarded!
        async with rt.lock:
            rt._ai_raise(ais[0])
        await asyncio.sleep(0.15)
        assert rt._prefetch is not None and rt._prefetch.participant_id == ais[0].id

        await rt.raise_hand(human)
        assert rt.queue[0] == human.id
        assert rt._prefetch is None  # invalidated because human jumped ahead of AI 1

        # 4. AI 2 finishes playback -> human gets floor immediately (0ms gap, no turn_gap_seconds wait)
        t_end = time.monotonic()
        await rt.report_playback_ended(rt.entries[1].turn_id)
        await asyncio.sleep(0.05)
        assert rt.active is not None and rt.active.participant_id == human.id
        assert (time.monotonic() - t_end) < 0.25

        # 5. Skip speaker clears any prefetch cleanly
        await rt.skip_speaker(human)
        assert rt._prefetch is None
        await rt.shutdown()

    asyncio.run(scenario())
