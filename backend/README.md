# GD Arena — Backend

Real-time Group Discussion (GD) practice backend built with **FastAPI**, **WebSockets**, **SQLite (SQLModel)**, and a provider-agnostic OpenAI-compatible LLM layer (defaulting to **Groq `openai/gpt-oss-120b`**, fallback `qwen/qwen3.6-27b`).

Supports voice-based human turns via `POST /stt` (Groq Whisper `whisper-large-v3-turbo`, swappable for local `faster-whisper` via `STT_PROVIDER`) and text turns.

---

## Project Structure

```text
backend/
├── app/
│   ├── main.py              # FastAPI app, lifespan, CORS, error handler
│   ├── config.py            # Environment settings (.env)
│   ├── db.py                # SQLite engine & session factory
│   ├── models.py            # SQLModel tables (Room, Participant, Turn, ScoreAdjustment)
│   ├── schemas.py           # REST request schemas
│   ├── timeutil.py          # UTC timestamp helpers
│   ├── api/
│   │   ├── rooms.py         # REST endpoints
│   │   └── ws.py            # WebSocket endpoint (/ws/{code})
│   ├── core/
│   │   ├── errors.py        # Domain error type (GDError)
│   │   ├── hub.py           # Non-blocking per-room WebSocket fan-out
│   │   ├── registry.py      # Live room registry + SQLite reload/recovery
│   │   └── runtime.py       # Room state machine, timer, turns, AI loop, report builder
│   ├── services/
│   │   ├── llm.py           # OpenAI-compatible wrapper (429 retry/backoff) + MockLLM
│   │   ├── ai_agent.py      # AI turn generation (<= 60 words) & hand-raising logic
│   │   ├── scoring.py       # Per-turn JSON scoring, leaderboard maths, final feedback
│   │   ├── personas.py      # Distinct AI personas (5 core + 5 extra for up to 10 seats)
│   │   ├── topics.py        # Topic bank loader
│   │   ├── stt.py           # Speech-to-text (Groq Whisper + faster-whisper stub)
│   │   └── tts.py           # Server-side TTS (Groq Orpheus WAV + Edge TTS fallback & cooldown)
│   └── data/
│       └── topics.json      # 37 GD topics across 4 categories
├── scripts/
│   └── run_fake_gd.py       # End-to-end fake GD runner (REST + WS + AI + scoring + report)
├── tests/
│   ├── test_llm.py          # Unit tests (429 retries, JSON fallback, personas, scoring)
│   └── test_full_gd.py      # Pytest wrapper for the end-to-end fake GD
├── .env.example             # Sample configuration
├── requirements.txt
├── API_CONTRACT.md          # Complete REST & WebSocket specification for the frontend
└── README.md
```

---

## Quick Start

### 1. Create a virtual environment and install dependencies

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and set your Groq API key:

```env
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_...
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=openai/gpt-oss-120b
LLM_FALLBACK_MODEL=qwen/qwen3.6-27b
LLM_REASONING_EFFORT=low
STT_PROVIDER=whisper
STT_MODEL=whisper-large-v3-turbo
STT_FALLBACK_MODEL=whisper-large-v3
TTS_PROVIDER=groq
GROQ_TTS_MODEL=canopylabs/orpheus-v1-english
TTS_ACCENT_PREFERENCE=neutral
```

> **No API key yet?** Set `LLM_PROVIDER=mock` (or leave `GROQ_API_KEY` empty) to run with the built-in offline `MockLLM`.
>
> **Using another OpenAI-compatible provider** (OpenAI, Together, OpenRouter, Ollama, vLLM): set `LLM_PROVIDER=openai_compatible`, `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL`.

### 3. Run the server

```bash
uvicorn app.main:app --reload --port 8000
```

Interactive OpenAPI docs are available at `http://localhost:8000/docs`, and the full REST + WebSocket spec is in [`API_CONTRACT.md`](API_CONTRACT.md).

---

## Running Tests & the Fake GD Script

### Unit + end-to-end test suite

```bash
pytest -v
```

### Standalone fake GD simulation

Runs a full discussion (room creation, moderator + scripted human player + AI participants, raise-hand turns, per-turn scoring, moderator score adjustments, timer end, and final report verification):

```bash
# Offline mock LLM (boots a temporary server automatically, 40s GD)
python scripts/run_fake_gd.py

# Real LLM configured in backend/.env (e.g. Groq)
python scripts/run_fake_gd.py --real

# Against an already running server
python scripts/run_fake_gd.py --base-url http://localhost:8000

# Custom options
python scripts/run_fake_gd.py --duration 60 --participants 5 --turn-limit 20 --end-after 25
```

---

## Key Behaviour Notes

- **Moderator vs. Host**: If a moderator joins (`role: "moderator"`), only they can start/end the GD, grant/skip turns, and adjust scores. If no moderator joins, the first human player acts as host (`can_moderate: true`).
- **AI seat filling**: When the GD starts (`lobby -> running`), empty player seats up to `max_participants` are filled with AI participants assigned distinct personas (the 5 core personas first: Aggressive Debater, Calm Analyst, Data-Driven Thinker, Empathetic Listener, Devil's Advocate).
- **Queue priority**: By default (`HUMAN_QUEUE_PRIORITY=true`), humans who raise their hand are placed ahead of waiting AIs so practice users don't get stuck behind bots.
- **Voice readiness**: Human turns pass through `app/services/stt.py` (`submit_turn` already accepts `audio_b64` + `mime_type`), and AI turns pass through `app/services/tts.py` (with `audio_url` in transcript entries and simulated speaking holds via `AI_SPEAKING_WPM`).

