# GDArena — Frontend

Web client for the GDArena real-time Group Discussion practice app, built with **Next.js (App Router)**, **TypeScript**, **Tailwind CSS**, and **lucide-react**.

Connects to the FastAPI + WebSocket backend in `../backend` strictly following `../backend/API_CONTRACT.md`.

---

## Project Structure

```text
frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx            # Root layout & light theme base
│   │   ├── globals.css           # Inter font & Tailwind directives
│   │   ├── page.tsx              # Home / Room Setup screen
│   │   ├── join/
│   │   │   └── page.tsx          # Join screen (room code, name, Player/Moderator)
│   │   └── room/
│   │       └── [code]/
│   │           └── page.tsx      # Live Room screen (Lobby, Running, Results)
│   ├── components/
│   │   ├── AppHeader.tsx         # Top navigation bar
│   │   ├── TimerBanner.tsx       # Topic banner + server-authoritative countdown & turn timers
│   │   ├── RoundTable.tsx        # Circular round-table seating (2–10 seats)
│   │   ├── TurnControls.tsx      # Raise hand, text submission, voice placeholder
│   │   ├── TranscriptPanel.tsx   # Auto-scrolling live transcript
│   │   ├── LeaderboardPanel.tsx  # Live leaderboard table
│   │   ├── ModeratorPanel.tsx    # Start/End GD, skip/grant turn, +/- points, score comments
│   │   ├── LobbyPanel.tsx        # Pre-start lobby view & room sharing
│   │   └── ResultsView.tsx       # Final leaderboard, best performer, per-participant reports
│   ├── hooks/
│   │   └── useRoomSocket.ts      # Single WS hook handling all events & auto-reconnect
│   └── lib/
│       ├── types.ts              # TypeScript interfaces matching backend schemas
│       ├── config.ts             # API & WebSocket base URL resolution
│       ├── api.ts                # Typed REST client & error handling
│       ├── storage.ts            # Session persistence (sessionStorage + localStorage)
│       └── format.ts             # Time, score, and label formatting helpers
├── .env.example
├── next.config.ts
├── tailwind.config.ts
└── package.json
```

---

## Setup & Run Instructions

### 1. Install dependencies

```bash
cd frontend
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Default values (already match the local backend):

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
```

### 3. Start the development server

```bash
npm run dev
```

Open `http://localhost:3000`.

### 4. Production build & checks

```bash
npm run typecheck
npm run lint
npm run build
npm run start
```

---

## Running Backend and Frontend Together

1. **Terminal 1 — Backend (`/backend`):**

   ```bash
   cd backend
   source .venv/bin/activate
   # Copy .env.example to .env and add GROQ_API_KEY (or set LLM_PROVIDER=mock for offline testing)
   uvicorn app.main:app --reload --port 8000
   ```

2. **Terminal 2 — Frontend (`/frontend`):**

   ```bash
   cd frontend
   npm run dev
   ```

---

### Voice Features
- **Human Microphone (STT):** Uses `MediaRecorder` and submits recorded audio to `POST /stt` (Groq Whisper), then automatically submits the transcribed text via `submit_turn`. Includes a small `"Use text instead"` fallback link for debugging.
- **AI Speech Output (TTS):** Plays server-synthesized Edge TTS MP3 clips (`GET /audio/{room_code}/{turn_id}.mp3`) sequentially through a queued `HTMLAudioElement` (with Web Speech API fallback only if browser voices are installed). Includes a header **AI Voice / AI Muted** toggle, a **Test voice** button (`POST /tts/test`), and an autoplay unlock banner if the browser blocks audio.

---

## Testing with One Browser Tab (You as Host/Moderator + Player with AIs)

1. Open `http://localhost:3000`.
2. Pick a topic (or leave **Let moderator choose** selected), choose participants (e.g., `4`), set duration (e.g., `2` minutes), and click **Create Room**.
3. On the Join screen, enter your name and keep **Player** selected, then click **Join Room** (this also unlocks browser audio playback). Because no separate moderator joined, you act as **Player (Host)** with both speaking controls and the Moderator Panel.
4. Click **Start Discussion**. Empty seats fill with AI personas, the server countdown starts, and the full leaderboard populates immediately.
5. Wait a couple of seconds for an AI to speak aloud, or click **Raise Hand**. When you hold the floor, click **Click to Speak (Microphone)**, allow microphone access, speak your point, and click again to stop and submit.
6. Use the **Moderator Panel** to adjust points, inspect score comments, or click **End GD** to view the final report.

For two-tab classroom testing, open `/join` in a second tab and join the first tab as **Moderator** and the second tab as **Player**.

