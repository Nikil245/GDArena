"""Unit tests for the LLM wrapper (429 retry/backoff, JSON parsing) and helpers."""

import asyncio
import json

import httpx
import pytest

from app.services import ai_agent, scoring
from app.services.llm import LLMError, LLMRateLimitError, OpenAICompatibleLLM, parse_json_object
from app.services.personas import CORE_PERSONAS, assign_personas


def _completion(content: str) -> dict:
    return {
        "id": "x", "object": "chat.completion", "created": 0, "model": "m",
        "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": content}}],
    }


def _client(handler) -> OpenAICompatibleLLM:
    return OpenAICompatibleLLM(
        provider="test", api_key="k", base_url="http://llm.test/v1", model="m",
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


def test_parse_json_object() -> None:
    assert parse_json_object('```json\n{"x": 2}\n```') == {"x": 2}
    assert parse_json_object('Here you go {"x": 3} thanks') == {"x": 3}
    with pytest.raises(LLMError):
        parse_json_object("no json here")


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

