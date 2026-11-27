"""Tests for Groq rate-limit/quota classification, service status tracking, room pause/recovery,
unscored turns, /stt 429 fallback, /status secret safety, and SIMULATE_LLM_EXHAUSTED."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import json
from typing import Any

import httpx
import openai
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.core.errors import GDError
from app.core.registry import generate_code
from app.core.runtime import RoomRuntime
from app.db import init_db, new_session
from app.main import app
from app.models import Role, Room
from app.services import stt as stt_svc, tts as tts_svc
from app.services.llm import LLMClient, LLMError, LLMRateLimitError, OpenAICompatibleLLM
from app.services.service_status import (
    ServiceStatusTracker,
    classify_provider_error,
    get_service_status,
    parse_retry_after_seconds,
    redact_secrets,
)
from app.services.stt import GroqWhisperSTT


def _completion(content: str) -> dict[str, Any]:
    return {
        "id": "x",
        "object": "chat.completion",
        "created": 0,
        "model": "m",
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": content},
            }
        ],
    }


def _rate_limit_exc(
    message: str,
    *,
    headers: dict[str, str] | None = None,
) -> openai.RateLimitError:
    req = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    resp = httpx.Response(
        429,
        headers=headers or {},
        json={"error": {"message": message, "type": "tokens"}},
        request=req,
    )
    return openai.RateLimitError(message, response=resp, body={"error": {"message": message}})


# --------------------------------------------------------------------------------------
# 1. Retry-time parsing & failure classification
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("message", "headers", "expected"),
    [
        ("Rate limit reached. Please try again in 2m2.25s.", None, 122.25),
        ("Rate limit reached. Please try again in 1h3m.", None, 3780.0),
        ("Please try again in 1h2m3.5s", None, 3723.5),
        ("Please try again in 45s.", None, 45.0),
        ("Please try again in 500ms", None, 0.5),
        ("Please try again in 1d2h3m4s", None, 93784.0),
        ("Please try again in 3 minutes 15 seconds", None, 195.0),
        ("Please try again in 2 hours", None, 7200.0),
        ("Too many requests", {"retry-after": "90"}, 90.0),
        ("Too many requests", {"retry-after-ms": "2500"}, 2.5),
        ("Rate limit exceeded without any duration", None, None),
    ],
)
def test_parse_retry_after_seconds_formats(
    message: str, headers: dict[str, str] | None, expected: float | None
) -> None:
    parsed = parse_retry_after_seconds(message, headers)
    if expected is None:
        assert parsed is None
    else:
        assert parsed == pytest.approx(expected, abs=0.01)


def test_classify_provider_errors() -> None:
    now = datetime(2026, 11, 27, 12, 0, 0, tzinfo=timezone.utc)

    # Daily TPD limit with retry time -> quota_exhausted + retry_at
    tpd_exc = _rate_limit_exc(
        "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01secret999` "
        "on tokens per day (TPD): Limit 100000, Used 100000. Please try again in 2m2.25s."
    )
    c_tpd = classify_provider_error(tpd_exc, now=now)
    assert c_tpd.kind == "quota_exhausted"
    assert c_tpd.retry_after_seconds == pytest.approx(122.25, abs=0.01)
    assert c_tpd.retry_at == now + timedelta(seconds=122.25)

    # Long retry time (>60s) even without "per day" wording -> quota_exhausted
    long_exc = _rate_limit_exc("Rate limit reached. Please try again in 1h3m.")
    c_long = classify_provider_error(long_exc, now=now)
    assert c_long.kind == "quota_exhausted"
    assert c_long.retry_after_seconds == 3780.0

    # Daily limit without parseable duration -> quota_exhausted with retry_at None
    no_time_quota = _rate_limit_exc("You exceeded your daily limit on requests per day (RPD).")
    c_no_time = classify_provider_error(no_time_quota, now=now)
    assert c_no_time.kind == "quota_exhausted"
    assert c_no_time.retry_at is None

    # Short per-minute 429 -> rate_limited_temporary
    rpm_exc = _rate_limit_exc("Rate limit reached on requests per minute. Please try again in 6s.")
    c_rpm = classify_provider_error(rpm_exc, now=now)
    assert c_rpm.kind == "rate_limited_temporary"
    assert c_rpm.retry_after_seconds == 6.0

    # 5xx and timeouts -> provider_unavailable
    req = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    c_timeout = classify_provider_error(openai.APITimeoutError(request=req), now=now)
    assert c_timeout.kind == "provider_unavailable"

    resp_503 = httpx.Response(503, text="unavailable", request=req)
    c_503 = classify_provider_error(
        openai.InternalServerError("server error", response=resp_503, body=None), now=now
    )
    assert c_503.kind == "provider_unavailable"

    # 400 -> other
    resp_400 = httpx.Response(400, text="bad", request=req)
    c_400 = classify_provider_error(
        openai.BadRequestError("bad request", response=resp_400, body=None), now=now
    )
    assert c_400.kind == "other"


def test_redact_secrets_strips_keys_and_org_ids() -> None:
    raw = (
        "Error for org_01abcDEF999 using Bearer gsk_superSecretKey123456789 "
        "and sk-anotherSecretKey98765"
    )
    cleaned = redact_secrets(raw)
    assert "org_01abcDEF999" not in cleaned
    assert "gsk_superSecretKey123456789" not in cleaned
    assert "sk-anotherSecretKey98765" not in cleaned


# --------------------------------------------------------------------------------------
# 2. Tracker retry-before-exhausted, single probe after retry_at, and simulation switch
# --------------------------------------------------------------------------------------


def test_llm_marks_exhausted_only_after_retries_and_probes_after_retry_at() -> None:
    clock = [datetime(2026, 11, 27, 12, 0, 0, tzinfo=timezone.utc)]
    tracker = ServiceStatusTracker(now_fn=lambda: clock[0])
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] <= 2:
            return httpx.Response(
                429,
                json={
                    "error": {
                        "message": (
                            "Rate limit reached in organization org_secret999 on tokens per day (TPD). "
                            "Please try again in 2m."
                        )
                    }
                },
            )
        return httpx.Response(200, json=_completion("Recovered point"))

    llm = OpenAICompatibleLLM(
        provider="groq",
        api_key="gsk_test_secret_123456789",
        base_url="http://llm.test/v1",
        model="openai/gpt-oss-120b",
        max_retries=1,
        backoff_base=0.01,
        backoff_max=0.02,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        status_tracker=tracker,
    )

    # First call tries initial + 1 retry (2 calls total), then marks exhausted.
    with pytest.raises(LLMRateLimitError) as exc_info:
        asyncio.run(llm.chat([{"role": "user", "content": "hi"}]))
    assert calls["n"] == 2
    assert exc_info.value.failure_kind == "quota_exhausted"
    assert "org_secret999" not in str(exc_info.value)
    assert "gsk_test_secret" not in str(exc_info.value)
    assert tracker.llm_status == "exhausted"
    assert tracker.llm_retry_at is not None

    # Immediate subsequent call is short-circuited without hitting the provider!
    with pytest.raises(LLMRateLimitError):
        asyncio.run(llm.chat([{"role": "user", "content": "hi again"}]))
    assert calls["n"] == 2

    # Advance clock past retry_at -> marks ok and allows one probe call, which succeeds.
    clock[0] = tracker.llm_retry_at + timedelta(seconds=1)
    assert tracker.public_status()["llm"] == "ok"

    # Concurrent probe guard: first caller gets probe slot, second is blocked while first is in flight
    allowed1, is_probe1 = tracker.try_begin_llm_call()
    allowed2, is_probe2 = tracker.try_begin_llm_call()
    assert (allowed1, is_probe1) == (True, True)
    assert (allowed2, is_probe2) == (False, False)
    tracker.finish_llm_probe()

    # Probe call runs and succeeds -> fully back to ok
    out = asyncio.run(llm.chat([{"role": "user", "content": "probe"}]))
    assert out == "Recovered point"
    assert calls["n"] == 3
    assert tracker.llm_status == "ok"


def test_simulation_switch_production_guard_and_recovery() -> None:
    clock = [datetime(2026, 11, 27, 12, 0, 0, tzinfo=timezone.utc)]
    tracker = ServiceStatusTracker(now_fn=lambda: clock[0])

    # Ignored in production by default
    prod_settings = Settings(
        environment="production",
        simulate_llm_exhausted="exhausted",
        allow_simulate_in_production=False,
    )
    assert tracker.configure_simulation(prod_settings) == "off"
    assert tracker.llm_status == "ok"

    # Explicitly allowed in production
    prod_opt_in = Settings(
        environment="production",
        simulate_llm_exhausted="exhausted",
        allow_simulate_in_production=True,
    )
    assert tracker.configure_simulation(prod_opt_in) == "exhausted"
    assert tracker.llm_status == "exhausted"
    assert tracker.llm_retry_at == clock[0] + timedelta(minutes=5)

    # Recover mode: exhausted until 60s after room start, then recovers automatically
    events: list[dict[str, Any]] = []
    tracker.subscribe(lambda ev: events.append(ev.public()))
    recover_settings = Settings(environment="development", simulate_llm_exhausted="recover")
    assert tracker.configure_simulation(recover_settings, recover_seconds=60.0) == "recover"
    assert tracker.is_llm_exhausted() is True
    tracker.notify_room_started()
    clock[0] = clock[0] + timedelta(seconds=30)
    assert tracker.is_llm_exhausted() is True
    clock[0] = clock[0] + timedelta(seconds=31)
    assert tracker.is_llm_exhausted() is False
    assert tracker.llm_status == "ok"
    assert any(e["service"] == "llm" and e["state"] == "ok" for e in events)


# --------------------------------------------------------------------------------------
# 3. Running room: broadcast exhausted & recovery, no AI retry spin, scoring skipped,
#    moderator continue_without_ai, leaderboard & final report with null scores
# --------------------------------------------------------------------------------------


def test_room_exhausted_broadcast_no_spin_unscored_turns_and_recovery() -> None:
    async def scenario() -> None:
        init_db()
        clock = [datetime(2026, 11, 27, 12, 0, 0, tzinfo=timezone.utc)]
        tracker = ServiceStatusTracker(now_fn=lambda: clock[0])

        class _ToggleQuotaLLM(LLMClient):
            provider = "groq"
            model = "openai/gpt-oss-120b"

            def __init__(self) -> None:
                self.calls = 0
                self.exhaust = True

            async def chat(
                self,
                messages,
                *,
                temperature=0.7,
                max_tokens=300,
                json_mode=False,
                purpose="generic",
                metadata=None,
            ) -> str:
                self.calls += 1
                if self.exhaust:
                    retry_at = clock[0] + timedelta(minutes=5)
                    tracker.record_llm_quota_exhausted(retry_at)
                    raise LLMRateLimitError(
                        "AI service usage limit reached.",
                        failure_kind="quota_exhausted",
                        retry_after_seconds=300.0,
                        retry_at=retry_at,
                    )
                tracker.record_llm_success()
                if purpose == "score":
                    return '{"relevance": 8, "clarity": 8, "content": 8, "teamwork": 8, "comment": "Good."}'
                if purpose == "report":
                    return '{"strengths": ["Clear"], "improvements": ["More data"], "summary": "Good."}'
                return "AI recovered and adds a practical perspective to the discussion."

        with new_session() as s:
            room = Room(
                code=generate_code(),
                topic="Quota limit runtime test",
                max_participants=3,
                duration_seconds=180,
                turn_limit_seconds=None,
                fill_with_ai=True,
            )
            s.add(room)
            s.commit()
            s.refresh(room)

        llm = _ToggleQuotaLLM()
        settings = Settings(llm_provider="mock", ai_speaking_wpm=0, ai_idle_nudge_seconds=0.5)
        rt = RoomRuntime(
            room,
            [],
            [],
            [],
            settings=settings,
            llm=llm,
            stt=stt_svc.TextOnlySTT(),
            tts=tts_svc.NullTTS(),
            service_status=tracker,
        )

        broadcasts: list[tuple[str, dict[str, Any]]] = []
        orig_broadcast = rt.hub.broadcast

        def spy_broadcast(event_type: str, data: dict[str, Any]) -> None:
            broadcasts.append((event_type, data))
            orig_broadcast(event_type, data)

        rt.hub.broadcast = spy_broadcast  # type: ignore[method-assign]

        host = await rt.join("Host", Role.PLAYER)
        player2 = await rt.join("PlayerTwo", Role.PLAYER)
        await rt.start(host)
        ais = [m for m in rt.players() if m.is_ai]
        assert len(ais) == 1

        # Trigger an AI turn -> hits quota exhaustion -> broadcasts service_status exhausted
        async with rt.lock:
            rt._ai_raise(ais[0])
        await asyncio.sleep(0.08)

        assert tracker.llm_status == "exhausted"
        exhausted_events = [
            data for etype, data in broadcasts if etype == "service_status" and data["state"] == "exhausted"
        ]
        assert len(exhausted_events) >= 1
        assert exhausted_events[0]["service"] == "llm"
        assert exhausted_events[0]["retry_at"] is not None
        assert rt.active is None
        assert all(not rt.members[pid].is_ai for pid in rt.queue)

        # Simulate repeated ticks while exhausted: AI must NOT raise hand or call LLM
        calls_after_exhaust = llm.calls
        async with rt.lock:
            for offset in (1.0, 2.0, 5.0, 10.0):
                rt._on_tick(rt._floor_free_since + offset)
        await asyncio.sleep(0.05)
        assert llm.calls == calls_after_exhaust
        assert rt.queue == []
        assert rt.active is None

        # Non-moderator player cannot send continue_without_ai
        with pytest.raises(GDError) as err_info:
            await rt.continue_without_ai(player2)
        assert err_info.value.code == "not_moderator"

        # Moderator/host can send continue_without_ai
        await rt.continue_without_ai(host)
        assert rt.ai_continue_without is True
        assert any(
            etype == "service_status" and data.get("continue_without_ai") is True
            for etype, data in broadcasts
        )

        # Human still gets floor & submits a turn -> marked not_scored without calling LLM or blocking
        await rt.raise_hand(host)
        assert rt.active is not None and rt.active.participant_id == host.id
        await rt.submit_turn(host, stt_svc.SpeechInput(text="Humans can keep discussing.", source="text"))
        await asyncio.sleep(0.05)

        assert llm.calls == calls_after_exhaust, "scoring must not call LLM while exhausted"
        assert rt.active is None
        assert len(rt.entries) == 1
        entry = rt.entries[0]
        assert entry.turn_score is None
        assert entry.scores is None
        assert entry.score_status == "not_scored"
        assert entry.score_reason == "scoring unavailable"

        # Leaderboard handles null scores without error
        board = rt.leaderboard()
        host_row = next(r for r in board if r["participant_id"] == host.id)
        assert host_row["turns"] == 1
        assert host_row["scored_turns"] == 0
        assert host_row["unscored_turns"] == 1
        assert host_row["average_turn_score"] is None
        assert host_row["total_score"] == 0

        # Simulate recovery (retry_at passes) -> broadcasts service_status ok and AIs resume!
        llm.exhaust = False
        clock[0] = clock[0] + timedelta(minutes=6)
        async with rt.lock:
            rt._on_tick(rt._floor_free_since + 15.0)
        await asyncio.sleep(0.08)

        ok_events = [
            data for etype, data in broadcasts if etype == "service_status" and data["state"] == "ok"
        ]
        assert len(ok_events) >= 1
        assert rt.ai_continue_without is False

        # Trigger another tick -> AI resumes and speaks!
        async with rt.lock:
            rt._on_tick(rt._floor_free_since + 20.0)
        await asyncio.sleep(0.1)
        assert any(e.is_ai for e in rt.entries)

        # End GD and check report handles mixed scored/unscored turns + scoring_note
        await rt.end("moderator", by=host)
        await asyncio.sleep(0.15)
        assert rt.report is not None
        assert rt.report["unscored_turns"] >= 1
        assert rt.report["scoring_note"] is not None
        assert "usage limit" in rt.report["scoring_note"].lower()

        await rt.shutdown()

    asyncio.run(scenario())


# --------------------------------------------------------------------------------------
# 4. POST /stt 429 rate-limit handling & fallback model + GET /status secret safety
# --------------------------------------------------------------------------------------


def test_stt_tries_fallback_model_and_returns_429_without_leaking_secrets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tracker = ServiceStatusTracker()
    seen_models: list[str] = []

    # Case A: primary model 429 -> fallback model succeeds
    def handler_fallback_ok(request: httpx.Request) -> httpx.Response:
        body_text = request.content.decode("latin-1", errors="ignore")
        if "whisper-large-v3-turbo" in body_text:
            seen_models.append("whisper-large-v3-turbo")
            return httpx.Response(
                429,
                json={
                    "error": {
                        "message": "Rate limit reached for org_secret_stt_123. Please try again in 15s."
                    }
                },
            )
        seen_models.append("whisper-large-v3")
        return httpx.Response(200, json={"text": "Fallback transcription worked."})

    stt_ok = GroqWhisperSTT(
        api_key="gsk_stt_secret_123456789",
        base_url="http://stt.test/v1",
        model="whisper-large-v3-turbo",
        fallback_model="whisper-large-v3",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler_fallback_ok)),
        status_tracker=tracker,
    )
    monkeypatch.setattr("app.api.rooms.get_stt", lambda: stt_ok)
    client = TestClient(app)

    resp_ok = client.post(
        "/stt",
        files={"file": ("turn.webm", b"fake-audio-bytes", "audio/webm")},
        data={"language": "en"},
    )
    assert resp_ok.status_code == 200
    assert resp_ok.json()["text"] == "Fallback transcription worked."
    assert "whisper-large-v3-turbo" in seen_models
    assert "whisper-large-v3" in seen_models

    # Case B: both primary and fallback return 429 -> HTTP 429 stt_rate_limited, no secrets
    def handler_both_429(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429,
            json={
                "error": {
                    "message": (
                        "Rate limit reached in organization org_secret_stt_999 for gsk_stt_secret_123456789. "
                        "Please try again in 22s."
                    )
                }
            },
        )

    stt_429 = GroqWhisperSTT(
        api_key="gsk_stt_secret_123456789",
        base_url="http://stt.test/v1",
        model="whisper-large-v3-turbo",
        fallback_model="whisper-large-v3",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler_both_429)),
        status_tracker=tracker,
    )
    monkeypatch.setattr("app.api.rooms.get_stt", lambda: stt_429)

    resp_429 = client.post(
        "/stt",
        files={"file": ("turn.webm", b"fake-audio-bytes", "audio/webm")},
        data={"language": "en"},
    )
    assert resp_429.status_code == 429
    payload = resp_429.json()
    assert payload["code"] == "stt_rate_limited"
    assert payload["retry_after_seconds"] == 22
    assert isinstance(payload["message"], str) and payload["message"]
    serialized = json.dumps(payload)
    assert "org_secret_stt_999" not in serialized
    assert "gsk_stt_secret" not in serialized


def test_get_status_is_cheap_secret_free_and_keeps_health_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tracker = ServiceStatusTracker()
    retry_target = datetime(2026, 11, 27, 13, 0, 0, tzinfo=timezone.utc)
    tracker._now = lambda: datetime(2026, 11, 27, 12, 55, 0, tzinfo=timezone.utc)
    tracker.record_llm_quota_exhausted(retry_target)

    monkeypatch.setattr("app.api.rooms.get_service_status", lambda: tracker)
    client = TestClient(app)

    status_resp = client.get("/status")
    assert status_resp.status_code == 200
    body = status_resp.json()
    assert set(body.keys()) == {"llm", "stt", "retry_at"}
    assert body["llm"] == "exhausted"
    assert body["stt"] == "ok"
    assert body["retry_at"] == "2026-11-27T13:00:00.000Z"
    raw_text = json.dumps(body)
    assert "gsk_" not in raw_text
    assert "org_" not in raw_text

    # /health stays unchanged
    health_resp = client.get("/health")
    assert health_resp.status_code == 200
    health_body = health_resp.json()
    assert health_body["status"] == "ok"
    assert "llm_provider" in health_body
    assert "stt_provider" in health_body

