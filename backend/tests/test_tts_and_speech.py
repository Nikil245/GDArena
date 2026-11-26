"""Tests for Groq Orpheus TTS, Edge fallback, 60s cooldown, WAV joining, and spoken AI turns."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.core.registry import generate_code
from app.core.runtime import RoomRuntime
from app.db import init_db, new_session
from app.main import app
from app.models import Role, Room
from app.services import ai_agent, stt as stt_svc, tts as tts_svc
from app.services.llm import LLMClient
from app.services.personas import ALL_PERSONAS, assign_personas, find_persona
from app.services.tts import (
    GROQ_ORPHEUS_MAX_CHARS,
    GROQ_ORPHEUS_VOICES,
    EdgeTTS,
    FallbackTTS,
    GroqOrpheusTTS,
    _make_silent_mp3,
    _make_silent_wav,
    audio_duration_seconds,
    build_tts,
    get_turn_audio_path,
    join_wav_chunks,
    prepare_text_for_tts,
    save_turn_audio,
    split_text_for_tts,
    strip_vocal_directions,
    verify_tts_voices,
    wav_duration_seconds,
)


def test_prepare_text_and_strip_vocal_directions() -> None:
    raw = "**[CHEERFUL]** Fair point, *Rohan*! About 71% of ₹10L (approx. $50M) & R&D govt. dept. spend vs. outcomes 👍."
    cleaned_groq = prepare_text_for_tts(raw, allow_vocal_directions=True)
    assert cleaned_groq.startswith("[cheerful] Fair point")
    assert "71 percent" in cleaned_groq
    assert "10 lakh rupees" in cleaned_groq or "10L" not in cleaned_groq
    assert "50 million dollars" in cleaned_groq
    assert "government" in cleaned_groq
    assert "department" in cleaned_groq
    assert "versus" in cleaned_groq
    assert "**" not in cleaned_groq and "👍" not in cleaned_groq

    stripped = strip_vocal_directions("[cheerful] Fair point, Rohan. [unknown tag] Let's focus.")
    assert stripped == "Fair point, Rohan. Let's focus."

    edge_cleaned = prepare_text_for_tts(raw, allow_vocal_directions=False)
    assert "[cheerful]" not in edge_cleaned
    assert "71 percent" in edge_cleaned


def test_split_text_respects_200_char_limit_on_sentences_and_join_wav() -> None:
    long_text = (
        "[thoughtful] First sentence stays short and conversational about remote work. "
        "Second sentence explains how hybrid schedules cut daily commute stress for teams across cities. "
        "Third sentence adds a balanced point on mentoring junior hires effectively without burning people out."
    )
    chunks = split_text_for_tts(long_text, max_chars=GROQ_ORPHEUS_MAX_CHARS)
    assert len(chunks) >= 2
    assert all(len(c) <= GROQ_ORPHEUS_MAX_CHARS for c in chunks)
    assert chunks[0].startswith("[thoughtful]")

    # Also test single oversized sentence without periods
    huge_sentence = "Word " * 70
    word_chunks = split_text_for_tts(huge_sentence.strip(), max_chars=GROQ_ORPHEUS_MAX_CHARS)
    assert len(word_chunks) >= 2
    assert all(len(c) <= GROQ_ORPHEUS_MAX_CHARS for c in word_chunks)

    wav1 = _make_silent_wav(0.6)
    wav2 = _make_silent_wav(0.8)
    joined = join_wav_chunks([wav1, wav2], pause_ms=100)
    dur = wav_duration_seconds(joined)
    assert dur == pytest.approx(1.5, abs=0.05)
    assert audio_duration_seconds(joined) == dur


def test_groq_orpheus_retries_once_and_joins_chunks() -> None:
    wav_piece = _make_silent_wav(0.5)
    requests_seen: list[dict] = []
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        requests_seen.append(json.loads(request.content))
        if calls["n"] == 1:
            return httpx.Response(429, headers={"retry-after": "0"}, json={"error": {"message": "rate limit"}})
        return httpx.Response(200, content=wav_piece, headers={"content-type": "audio/wav"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    groq = GroqOrpheusTTS(
        api_key="test-key",
        base_url="https://api.groq.test/openai/v1",
        model="canopylabs/orpheus-v1-english",
        backoff_seconds=0.01,
        http_client=client,
    )
    long_text = (
        "[cheerful] Short opening sentence from Meera about city infrastructure and public transit. "
        "Here is another complete sentence clearly extending past two hundred characters so Groq synthesis splits cleanly on sentence boundaries. "
        "And a crisp third closing sentence to join cleanly."
    )
    out = asyncio.run(groq.synthesize(long_text, voice="diana"))
    asyncio.run(groq.aclose())
    asyncio.run(client.aclose())

    assert len(requests_seen) >= 3  # 1 failed 429 + retry + remaining chunk
    assert all(r["model"] == "canopylabs/orpheus-v1-english" for r in requests_seen)
    assert all(r["voice"] == "diana" for r in requests_seen)
    assert all(r["response_format"] == "wav" for r in requests_seen)
    assert all(len(r["input"]) <= GROQ_ORPHEUS_MAX_CHARS for r in requests_seen)
    assert out[:4] == b"RIFF"
    assert wav_duration_seconds(out) > 0.5


def test_fallback_tts_terms_error_trips_60s_cooldown_and_skips_primary(monkeypatch: pytest.MonkeyPatch) -> None:
    groq_calls = {"n": 0}
    edge_texts: list[str] = []
    edge_voices: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        groq_calls["n"] += 1
        return httpx.Response(
            400,
            json={
                "error": {
                    "code": "model_terms_required",
                    "message": "Terms acceptance required for canopylabs/orpheus-v1-english.",
                }
            },
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    groq = GroqOrpheusTTS(
        api_key="test-key",
        base_url="https://api.groq.test/openai/v1",
        http_client=client,
    )
    edge = EdgeTTS()

    async def fake_edge_synth(text: str, voice: str = "en-US-JennyNeural", *, rate: str = "+0%") -> bytes:
        edge_texts.append(prepare_text_for_tts(text, allow_vocal_directions=False))
        edge_voices.append(voice)
        return _make_silent_mp3(15)

    monkeypatch.setattr(edge, "synthesize", fake_edge_synth)
    fallback_tts = FallbackTTS(primary=groq, fallback=edge, cooldown_seconds=60.0)

    meera = ALL_PERSONAS["calm_analyst"]
    # Turn 1: hits 400 model_terms_required -> fails fast (no retry), trips 60s cooldown, uses Edge
    res1 = asyncio.run(
        fallback_tts.synthesize_for_persona("[thoughtful] Fair point, Arjun.", persona=meera)
    )
    assert res1 is not None
    assert res1.provider == "edge"
    assert res1.ext == "mp3"
    assert edge_voices[-1] == meera.voice
    assert "[thoughtful]" not in edge_texts[-1]
    assert groq_calls["n"] == 1
    assert fallback_tts.is_primary_in_cooldown is True

    # Turn 2 within 60s: Groq skipped completely!
    res2 = asyncio.run(
        fallback_tts.synthesize_for_persona("[serious] Another turn right after.", persona=ALL_PERSONAS["aggressive_debater"])
    )
    assert res2 is not None and res2.provider == "edge"
    assert groq_calls["n"] == 1
    asyncio.run(client.aclose())


def test_persona_voice_assignments_and_indian_accent_preference(monkeypatch: pytest.MonkeyPatch) -> None:
    picks_10 = assign_personas(10, set())
    assert len(picks_10) == 10
    groq_voices = [p.groq_voice for p, _ in picks_10[:6]]
    assert set(groq_voices) == set(GROQ_ORPHEUS_VOICES)
    assert all(p.groq_voice is None for p, _ in picks_10[6:])
    assert len({p.voice for p, _ in picks_10}) == 10

    settings_indian = Settings(
        groq_api_key="test-key",
        tts_provider="groq",
        tts_accent_preference="indian",
    )
    tts_indian = build_tts(settings_indian)
    assert isinstance(tts_indian, FallbackTTS)
    assert tts_indian.name == "edge"

    seen: list[tuple[str, str]] = []

    async def fake_edge(text: str, voice: str = "en-US-JennyNeural", *, rate: str = "+0%") -> bytes:
        seen.append((voice, text))
        return _make_silent_mp3(12)

    monkeypatch.setattr(tts_indian.fallback, "synthesize", fake_edge)
    res = asyncio.run(
        tts_indian.synthesize_for_persona("[cheerful] Let's focus on jobs.", persona=ALL_PERSONAS["empathetic"])
    )
    assert res is not None
    assert res.provider == "edge"
    assert seen[-1][0] == "en-IN-NeerjaExpressiveNeural"
    assert "[cheerful]" not in seen[-1][1]


def test_spoken_ai_prompt_and_vocal_direction_stripping() -> None:
    persona = ALL_PERSONAS["aggressive_debater"]
    msgs = ai_agent.build_ai_turn_messages(
        name="Arjun",
        persona=persona,
        topic="Should remote work stay permanent?",
        participants=["Arjun", "Meera"],
        history=[("Meera", "Remote work saves time on daily commutes.")],
    )
    sys_prompt = msgs[0]["content"]
    assert "40 to 60 words" in sys_prompt
    assert "contractions" in sys_prompt
    assert "seventy-one percent" in sys_prompt
    assert "[serious]" in sys_prompt

    raw = "Arjun: [SERIOUS] Fair point, Meera, [whisper] but over 70% of teams still lose mentoring! (Honestly) **Big problem**."
    gen = ai_agent.clean_turn_texts(raw, name="Arjun", max_words=60)
    assert "[" not in gen.text and "]" not in gen.text
    assert "**" not in gen.text and "(" not in gen.text
    assert gen.text.startswith("Fair point, Meera")
    assert gen.tts_text.startswith("[serious]")
    assert "[whisper]" not in gen.tts_text
    assert "70 percent" in gen.tts_text


def test_wav_endpoints_and_tts_test_persona_and_startup_check(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    wav_bytes = _make_silent_wav(1.25)
    saved = save_turn_audio("WAV01", 3, wav_bytes, base_dir=tmp_path)
    assert saved.suffix == ".wav"
    assert get_turn_audio_path("WAV01", 3, base_dir=tmp_path) == saved

    def groq_handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "canopylabs/orpheus-v1-english"}]})
        if request.url.path.endswith("/audio/speech"):
            return httpx.Response(200, content=wav_bytes)
        return httpx.Response(404)

    mock_http = httpx.AsyncClient(transport=httpx.MockTransport(groq_handler))
    groq = GroqOrpheusTTS(
        api_key="test-key",
        base_url="https://api.groq.test/openai/v1",
        http_client=mock_http,
    )
    edge = EdgeTTS()
    fallback_tts = FallbackTTS(primary=groq, fallback=edge)

    async def fake_list_voices():
        return [{"ShortName": p.voice, "Locale": "en-US"} for p in ALL_PERSONAS.values()]

    startup = asyncio.run(
        verify_tts_voices(
            fallback_tts,
            Settings(groq_api_key="k", groq_tts_model="canopylabs/orpheus-v1-english"),
            list_voices_fn=fake_list_voices,
            http_client=mock_http,
        )
    )
    assert startup["status"] == "ok"
    assert startup["model_available"] is True
    assert startup["groq_ok"] is True

    monkeypatch.setattr("app.api.rooms.get_turn_audio_path", lambda rc, tid: get_turn_audio_path(rc, tid, base_dir=tmp_path))
    monkeypatch.setattr("app.api.rooms.get_tts", lambda: fallback_tts)

    client = TestClient(app)
    audio_resp = client.get("/audio/WAV01/3.wav")
    assert audio_resp.status_code == 200
    assert audio_resp.headers["content-type"].startswith("audio/wav")
    assert audio_resp.content == wav_bytes

    assert find_persona("Meera") == ALL_PERSONAS["calm_analyst"]
    tts_resp = client.post("/tts/test", json={"persona": "calm_analyst"})
    assert tts_resp.status_code == 200
    assert tts_resp.headers["content-type"].startswith("audio/wav")
    assert tts_resp.headers["x-tts-provider"] == "groq"
    assert tts_resp.headers["x-tts-voice"] == "diana"
    assert tts_resp.headers["x-audio-format"] == "wav"
    assert float(tts_resp.headers["x-audio-duration"]) == pytest.approx(1.25, abs=0.05)

    bad_persona = client.post("/tts/test", json={"persona": "does_not_exist"})
    assert bad_persona.status_code == 400
    assert bad_persona.json()["error"]["code"] == "unknown_persona"
    asyncio.run(mock_http.aclose())


def test_runtime_wav_prefetch_strips_tags_from_transcript_and_scoring() -> None:
    seen_scored_texts: list[str] = []

    class _TagLLM(LLMClient):
        provider = "mock"
        model = "mock-gd"

        async def chat(self, messages, *, temperature=0.7, max_tokens=300, json_mode=False, purpose="generic", metadata=None):
            if purpose == "score":
                seen_scored_texts.append(messages[-1]["content"])
                return '{"relevance": 8, "clarity": 8, "content": 8, "teamwork": 8, "comment": "Natural delivery."}'
            if purpose == "report":
                return '{"strengths": ["Clear"], "improvements": ["More data"], "summary": "Good."}'
            return "[cheerful] Fair point, team, it's clear that hybrid policies help around 60% of staff."

    def groq_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=_make_silent_wav(1.5))

    mock_http = httpx.AsyncClient(transport=httpx.MockTransport(groq_handler))
    groq = GroqOrpheusTTS(api_key="test-key", http_client=mock_http)
    tts = FallbackTTS(primary=groq, fallback=EdgeTTS())

    async def scenario() -> None:
        init_db()
        with new_session() as s:
            room = Room(
                code=generate_code(),
                topic="Hybrid work policies",
                max_participants=2,
                duration_seconds=120,
                turn_limit_seconds=None,
                fill_with_ai=True,
            )
            s.add(room)
            s.commit()
            s.refresh(room)

        rt = RoomRuntime(
            room,
            [],
            [],
            [],
            settings=Settings(llm_provider="mock", ai_speaking_wpm=150, turn_gap_seconds=1.0),
            llm=_TagLLM(),
            stt=stt_svc.TextOnlySTT(),
            tts=tts,
        )
        human = await rt.join("Host", Role.PLAYER)
        await rt.start(human)
        ai_player = next(m for m in rt.players() if m.is_ai)
        async with rt.lock:
            rt._ai_raise(ai_player)
        await asyncio.sleep(0.25)

        assert len(rt.entries) == 1
        entry = rt.entries[0]
        assert entry.audio_url == f"/audio/{rt.code}/{entry.turn_id}.wav"
        assert entry.audio_duration_seconds == pytest.approx(1.5, abs=0.05)
        assert "[cheerful]" not in entry.text
        assert all("[cheerful]" not in scored for scored in seen_scored_texts)
        await rt.shutdown()
        await mock_http.aclose()

    asyncio.run(scenario())

